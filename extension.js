const Clutter = imports.gi.Clutter;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const EXT_NAME = `[${Me.metadata.name}]`;

const Meta = imports.gi.Meta;
const overview = imports.ui.main.overview;


function get_window_actor(window) {
    for (const actor of global.get_window_actors()) {
        if (!actor.is_destroyed() && actor.get_meta_window() === window) {
            return actor;
        }
    }

    return undefined;
}

function cursor_within_window(mouse_x, mouse_y, win) {
    // use get_buffer_rect instead of get_frame_rect here, because the frame_rect may
    // exclude shadows, which might already cause a focus-on-hover event, therefore causing
    // the pointer to jump around eratically.
    let rect = win.get_buffer_rect();

    dbg_log(`window rect: ${rect.x}:${rect.y} - ${rect.width}:${rect.height}`);

    return mouse_x >= rect.x &&
        mouse_x <= rect.x + rect.width &&
        mouse_y >= rect.y &&
        mouse_y <= rect.y + rect.height;
}

// logging disabled by default
const DEBUGGING = true;

function dbg_log(message) {
    if (DEBUGGING) {
        log(EXT_NAME, message);
    }
}


class Extension {

    focus_changed(win) {
        const actor = get_window_actor(win);
        dbg_log('window focus event received');
        if (actor) {
            let rect = win.get_buffer_rect();

            let seat = Clutter.get_default_backend().get_default_seat();
            let [mouse_x, mouse_y, _] = global.get_pointer();

            let time_to_last_event = global.display.get_current_time_roundtrip() - this.last_mouse_event;

            if (cursor_within_window(mouse_x, mouse_y, win)) {
                dbg_log('pointer within window, discarding event');
            } else if (overview.visible) {
                dbg_log('overview visible, discarding event');
            } else if (rect.width < 10 && rect.height < 10) {
                // xdg-copy creates a 1x1 pixel window to capture mouse events.
                // Ignore this and similar windows.
                dbg_log('window too small, discarding event');
            } else if (time_to_last_event < 500 /*ms*/) {
                dbg_log("Recent pointer interaction, discarding event");
            } else {
                dbg_log('targeting new window');
                seat.warp_pointer(rect.x + rect.width / 2, rect.y + rect.height / 2);
            }

        }
    }

    connect_to_window(win) {
        const type = win.get_window_type();
        if (type !== Meta.WindowType.NORMAL) {
            dbg_log(`ignoring window, window type: ${type}`);
            return;
        }

        win._mousefollowsfocus_extension_signal = win.connect('focus', this.focus_changed.bind(this));
    }

    get_focused_window() {
        for (const actor of global.get_window_actors()) {
            if (actor.is_destroyed()) {
                continue;
            }

            const win = actor.get_meta_window();
            if (win.has_focus()) {
                return win;
            }
        }

        return undefined;
    }

    event_filter(event) {
        let device = event.get_device();
        if(device) {
            switch (device.get_device_type()) {
                case Clutter.InputDeviceType.POINTER_DEVICE:
                case Clutter.InputDeviceType.TOUCHPAD_DEVICE:
                case Clutter.InputDeviceType.CURSOR_DEVICE:
                    // Input from "mouse" detected
                    this.last_mouse_event = global.display.get_current_time_roundtrip();
                    dbg_log(`test: ${device.get_has_cursor()} event: ${this.last_mouse_event}`);
                    break;
                default:
                    break;
            }
        }

        return Clutter.EVENT_PROPAGATE;
    }

    constructor() {
    }

    enable() {
        dbg_log(`enabling ${Me.metadata.name}`);

        for (const actor of global.get_window_actors()) {
            if (actor.is_destroyed()) {
                continue;
            }

            const win = actor.get_meta_window();
            this.connect_to_window(win);
        }

        this.create_signal = global.display.connect('window-created', (ignore, win) => {
            dbg_log(`window created ${win}`);

            this.connect_to_window(win);
        });

        this.hide_signal = overview.connect('hidden', () => {
            // the focus might change whilst we're in the overview, i.e. by
            // searching for an already open app.
            const win = this.get_focused_window();
            if (win !== undefined) {
                this.focus_changed(win)
            }
        });

        this.last_mouse_event = 0;
        this.event_filter_id = Clutter.Event.add_filter(global.stage, this.event_filter.bind(this));
    }

    // REMINDER: It's required for extensions to clean up after themselves when
    // they are disabled. This is required for approval during review!
    disable() {
        dbg_log(`disabling ${Me.metadata.name}`);

        if (this.create_signal !== undefined) {
            global.display.disconnect(this.create_signal);
            this.create_signal = undefined;
        }

        if (this.hide_signal !== undefined) {
            overview.disconnect(this.hide_signal);
            this.hide_signal = undefined;
        }

        if (this.event_filter_id !== undefined) {
            Clutter.Event.remove_filter(this.event_filter_id);
            this.event_filter_id = undefined;
        }

        for (const actor of global.get_window_actors()) {
            if (actor.is_destroyed()) {
                continue;
            }

            const win = actor.get_meta_window();
            if (win._mousefollowsfocus_extension_signal) {
                win.disconnect(win._mousefollowsfocus_extension_signal);
                delete win._mousefollowsfocus_extension_signal;
            }
        }
    }
}


function init() {
    dbg_log(`initializing ${Me.metadata.name}`);

    return new Extension();
}

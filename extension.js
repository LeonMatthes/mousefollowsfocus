const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Gdk = imports.gi.Gdk;
const Clutter = imports.gi.Clutter;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const GLib = imports.gi.GLib;
const Meta = imports.gi.Meta;
const overview = imports.ui.main.overview;

function get_window_actor(window) {
    for (const actor of global.get_window_actors()) {
        if(!actor.is_destroyed() && actor.get_meta_window() === window) {
            return actor;
        }
    }

    return undefined;
}

function cursor_within_rect(mouse_x, mouse_y, rect) {
    return mouse_x >= rect.x &&
        mouse_x <= rect.x + rect.width &&
        mouse_y >= rect.y &&
        mouse_y <= rect.y + rect.height;
}

function focus_changed(win) {
    const actor = get_window_actor(win);
    log(`window focus event received`);
    if(actor) {
        let rect = win.get_frame_rect();

        let seat = Clutter.get_default_backend().get_default_seat();
        let [mouse_x, mouse_y, mouse_mask] = global.get_pointer();

        if(cursor_within_rect(mouse_x, mouse_y, rect)) {
            log(`pointer within window, discarding event`);
        }
        else if(overview.visible) {
            log(`overview visible, discarding event`);
        }
        else {
            log(`targeting new window`);
            seat.warp_pointer(rect.x + rect.width / 2, rect.y + rect.height / 2);
        }

    }
}

function connect_to_window(win) {
    const type = win.get_window_type();
    if(type != Meta.WindowType.NORMAL) {
        log(`ignoring window, window type: ${type}`);
        return;
    }

    win._mousefollowsfocus_extension_signal = win.connect('focus', focus_changed);
}

class Extension {
    constructor() {
    }

    enable() {
        log(`enabling ${Me.metadata.name}`);

        for (const actor of global.get_window_actors()) {
            if(actor.is_destroyed()) {
                continue;
            }

            const win = actor.get_meta_window();
            connect_to_window(win);
        }

        this.create_signal = global.display.connect('window-created', function (ignore, win) {
            log(`window created ${win}`);

            connect_to_window(win);
        });

    }

    // REMINDER: It's required for extensions to clean up after themselves when
    // they are disabled. This is required for approval during review!
    disable() {
        log(`disabling ${Me.metadata.name}`);

        if (this.create_signal !== undefined) {
            global.display.disconnect(this.create_signal);
            this.create_signal = undefined;
        }

        for (const actor of global.get_window_actors()) {
            if (actor.is_destroyed()) {
                continue;
            }

            const win = actor.get_meta_window();
            if(win._mousefollowsfocus_extension_signal) {
                win.disconnect(win._mousefollowsfocus_extension_signal);
                delete win._mousefollowsfocus_extension_signal;
            }
        }

    }
}


function init() {
    log(`initializing ${Me.metadata.name}`);

    return new Extension();
}

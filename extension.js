import Clutter from "gi://Clutter";
import Meta from "gi://Meta";
import { overview } from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

let DEBUGGING = false;

let EXT_NAME = "unknown_extension";

export default class MouseFollowsFocus extends Extension {
    constructor(metadata) {
        super(metadata);
        EXT_NAME = metadata.name;
    }

    enable() {
        dbg_log(`enabling ${EXT_NAME}`);

        for (const actor of global.get_window_actors()) {
            if (actor.is_destroyed()) {
                continue;
            }

            const win = actor.get_meta_window();
            connect_to_window(win);
        }

        this.create_signal = global.display.connect(
            "window-created",
            (_ignore, win) => {
                dbg_log(`window created ${win}`);

                connect_to_window(win);
            },
        );

        this.hide_signal = overview.connect("hidden", () => {
            // the focus might change whilst we're in the overview, i.e. by
            // searching for an already open app.
            const win = get_focused_window();
            if (win !== null) {
                focus_changed(win);
            }
        });
    }

    // REMINDER: It's required for extensions to clean up after themselves when
    // they are disabled. This is required for approval during review!
    disable() {
        dbg_log(`disabling ${EXT_NAME}`);

        if (this.create_signal !== undefined) {
            global.display.disconnect(this.create_signal);
            this.create_signal = undefined;
        }

        if (this.hide_signal !== undefined) {
            overview.disconnect(this.hide_signal);
            this.hide_signal = undefined;
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

    return (
        mouse_x >= rect.x &&
        mouse_x <= rect.x + rect.width &&
        mouse_y >= rect.y &&
        mouse_y <= rect.y + rect.height
    );
}

function dbg_log(message) {
    if (DEBUGGING) {
        log(EXT_NAME, message);
    }
}

function focus_changed(win) {
    const actor = get_window_actor(win);
    dbg_log("window focus event received");

    if (actor) {
        let rect = win.get_buffer_rect();

        let [mouse_x, mouse_y, _] = global.get_pointer();

        if (cursor_within_window(mouse_x, mouse_y, win)) {
            dbg_log("pointer within window, discarding event");
        } else if (overview.visible) {
            dbg_log("overview visible, discarding event");
        } else if (rect.width < 10 && rect.height < 10) {
            // xdg-copy creates a 1x1 pixel window to capture mouse events.
            // Ignore this and similar windows.
            dbg_log("window too small, discarding event");
        } else {
            dbg_log("targeting new window");
            let seat = Clutter.get_default_backend().get_default_seat();
            if (seat !== null) {
                seat.warp_pointer(
                    rect.x + rect.width / 2,
                    rect.y + rect.height / 2,
                );
            } else {
                dbg_log("seat is null!");
            }
        }
    }
}

function connect_to_window(win) {
    const type = win.get_window_type();
    if (type !== Meta.WindowType.NORMAL) {
        dbg_log(`ignoring window, window type: ${type}`);
        return;
    }

    win._mousefollowsfocus_extension_signal = win.connect(
        "focus",
        focus_changed,
    );
}

function get_focused_window() {
    return global.display.focus_window;
}

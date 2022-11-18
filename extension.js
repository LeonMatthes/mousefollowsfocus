const Clutter = imports.gi.Clutter;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const EXT_NAME = `[${Me.metadata.name}]`;

const Meta = imports.gi.Meta;
const overview = imports.ui.main.overview;

// Required to attach to `Main.activateWindow` aka monkey patching
const Main = imports.ui.main;

// ↓ Not used anymore, also `for` loop isn't great on performance
/* function get_window_actor(window) {
    for (const actor of global.get_window_actors()) {
        if (!actor.is_destroyed() && actor.get_meta_window() === window) {
            return actor;
        }
    }

    return undefined;
} */

function cursor_within_rect(rect) {
    // > use get_buffer_rect instead of get_frame_rect here, because the frame_rect may
    // > exclude shadows, which might already cause a focus-on-hover event, therefore causing
    // > the pointer to jump around eratically.
    // `get_frame_rect` is used again, because now the extension doesn't rely on arbitrary
    // focus change event. So making the rect more precise helps with reducing mouse travel distance.
    let [mouse_x, mouse_y, _] = global.get_pointer();
    const cursor_rect = new Meta.Rectangle({ x: mouse_x, y: mouse_y, width: 1, height: 1 });
    return cursor_rect.intersect(rect)[0];

/*     let rect = win.get_frame_rect();

    dbg_log(`window rect: ${rect.x}:${rect.y} - ${rect.width}:${rect.height}`);

    return mouse_x >= rect.x &&
        mouse_x <= rect.x + rect.width &&
        mouse_y >= rect.y &&
        mouse_y <= rect.y + rect.height; */
}

// logging disabled by default
const DEBUGGING = false;

function dbg_log(message) {
    if (DEBUGGING) {
        log(EXT_NAME, message);
    }
}

function signal_disconnect_and_delete(obj, signal) {
    if (signal) {
        obj.disconnect(signal);
        delete signal;
    }
}

function signal_disconnect_and_undefine(obj, signal) {
    if (signal !== undefined) {
        obj.disconnect(signal);
        signal = undefined;
    }
}

function win_focus_signal_disconnect_and_delete(win) {
    signal_disconnect_and_delete(win, win._mousefollowsfocus_extension_signal_focus);
}

// -----------
// These are the replication of gnome-shell handling window attention

function win_demands_attention(win) {
    dbg_log('new window demands attention, assuming not in foreground, discarding it');
    win_focus_signal_disconnect_and_delete(win);
    dbg_log(`disconnecting from ${win} ('notify::demands-attention' signal)`);
    signal_disconnect_and_delete(win, win._mousefollowsfocus_extension_signal_demands_attention);
}

function win_urgent(win) {
    dbg_log('new window is in urgent, assuming not in foreground, discarding it');
    win_focus_signal_disconnect_and_delete(win);
    dbg_log(`disconnecting from ${win} ('notify::urgent' signal)`);
    signal_disconnect_and_delete(win, win._mousefollowsfocus_extension_signal_urgent);
}

function win_focus_changed(win) {
    dbg_log('window focus event received');
    move_cursor(win);
    win_focus_signal_disconnect_and_delete(win);
}

function win_unmanaged(win) {
    dbg_log('new window is unmanaged, discarding it');
    win_focus_signal_disconnect_and_delete(win);
    dbg_log(`disconnecting from ${win} ('unmanaged' signal)`);
    signal_disconnect_and_delete(win, win._mousefollowsfocus_extension_signal_unmanaged);
}

function win_shown(win) {
    dbg_log('new window is shown without `focus`, `urgent` or `demands_attention`, probably due to gnome-shell restarted, discarding it');
    signal_disconnect_and_delete(win, win._mousefollowsfocus_extension_signal_focus);
    dbg_log(`disconnecting from ${win} ('shown' signal)`);
    signal_disconnect_and_delete(win, win._mousefollowsfocus_extension_signal_shown);
}

// -----------

async function move_cursor(win) {
    dbg_log(`attempting to move cursor to ${win}`);
    let rect = win.get_buffer_rect();
    if (cursor_within_rect(rect)) {
        dbg_log('pointer within window, discarding event');
    } else if (overview.visible) {
        dbg_log('overview visible, discarding event');
    } else if (rect.width < 10 && rect.height < 10) {
        // ↑ xdg-copy creates a 1x1 pixel window to capture mouse events.
        // Ignore this and similar windows.
        dbg_log('window too small, discarding event');
    } else {
        dbg_log('moving mouse to the window');
        let seat = Clutter.get_default_backend().get_default_seat();
        if (seat !== null) {
            seat.warp_pointer(rect.x + rect.width / 2, rect.y + rect.height / 2);
        }
        else {
            dbg_log('seat is null!');
        }
    }
}

function connect_to_window(win) {
    // ↑ Read as: trigger mouse movement when the window is opened in foreground.
    // ↓ Store window type to avoid calling it twice
    const type = win.get_window_type();
    // ↓ Also includes DIALOG and MODAL_DIALOG in additional to NORMAL.
    switch (type) {
        case Meta.WindowType.NORMAL: 
            break;
        case Meta.WindowType.DIALOG:
            break;
        case Meta.WindowType.MODAL_DIALOG:
            break;
        default:
            dbg_log(`ignoring window, window type: ${type}`);
            return;
    }

    // ↓ This replicates the way gnome-shell handles window attention.
    // Combining with the actual functions,
    // only newly created window that has focus
    // (not opened in the background)
    // will cause mouse movement.
    win._mousefollowsfocus_extension_signal_demands_attention = win.connect('notify::demands-attention', win_demands_attention);
    win._mousefollowsfocus_extension_signal_urgent = win.connect('notify::urgent', win_urgent);
    win._mousefollowsfocus_extension_signal_focus = win.connect('focus', win_focus_changed);
    win._mousefollowsfocus_extension_signal_unmanaged = win.connect('unmanaged', win_unmanaged);
    // ↓ `shown` isn't part of gnome-shell window attention handling
    // However without it there will be an issue:
    // When you restart gnome-shell, all windows are registered as recreation,
    // but without `notify::demands-attention` or `notify::urgent` signal,
    // this will cause the extension to stuck waiting for window's `focus`
    // signal forever. You can observe this by:
    // 1. switching to a new workspace using keyboard shortcut
    // 2. restart gnome-shell
    // 3. switch back (with keyboard) to previous workspace that has window
    // 4. observe how extension tries to move the cursor, even though it's not
    //    a newly created window (from user's perspective)
    // `shown` doesn't trigger when a new window demanding attention is within
    // the current workspace, which means other signals are still necessary.
    win._mousefollowsfocus_extension_signal_shown = win.connect('shown', win_shown);
}

function get_focused_window() {
    return global.display.focus_window;
}

function win_size_changed(win) {
    dbg_log('Currently focused window has size change');
    move_cursor(win);
    signal_disconnect_and_delete(win, win._mousefollowsfocus_extension_signal_size_changed);
}

function win_position_changed(win) {
    dbg_log('Currently focused window has position change');
    move_cursor(win);
    signal_disconnect_and_delete(win, win._mousefollowsfocus_extension_signal_position_changed);
}

class Extension {
    constructor() {
    }

    enable() {
        dbg_log(`enabling ${Me.metadata.name}`);

        // ↓ These shouldn't be necessary anymore as it tries to attach to all
        // existing windows but now we don't do that anymore because handling
        // focus change is now done by three separate things:
        // 1. Attaching to `Main.activateWindow` (used by Alt + Tab switcher and
        //    many extensions, e.g. Dash to Dock, Dash to Panel)
        // 2. Attaching to 'window-created' and only start acting when window is
        //    opened in foreground
        // 3. Attaching to overview's `hidden` signal, so that exiting Overviw
        //    also triggers mouse movement

/*         for (const actor of global.get_window_actors()) {
            if (actor.is_destroyed()) {
                continue;
            }

            const win = actor.get_meta_window();
            connect_to_window(win);
        } */

        this.origMethods = {
            "Main.activateWindow": Main.activateWindow
          };
          Main.activateWindow = (win, ...args) => {
            dbg_log(`'Main.activateWindow' triggered for ${win}`);
            move_cursor(win);
            this.origMethods["Main.activateWindow"](win, ...args);
          };

        this.create_signal = global.display.connect('window-created', function (ignore, win) {
            dbg_log(`window created ${win}`);
            connect_to_window(win);
        });

/*         this.focus_changed_signal = global.display.connect('notify::focus-window', function (ignore) {
            const win = get_focused_window();
            dbg_log(`Attaching to currently focused window: ${win}`);
            win._mousefollowsfocus_extension_signal_size_changed = win.connect('size-changed', win_size_changed);
            // ↓ Nope, this is too laggy:
            // It'll try to move mouse in every single tick and cause gnome animation to stutter,
            // disabling it for now.
            //win._mousefollowsfocus_extension_signal_position_changed = win.connect('position-changed', win_position_changed);
        }); */

        this.hide_signal = overview.connect('hidden', function() {
            // ↑ the focus might change whilst we're in the overview, i.e. by
            // searching for an already open app.
            const win = get_focused_window();
            if (win !== null) {
                move_cursor(win);
            }
        });
    }

    // REMINDER: It's required for extensions to clean up after themselves when
    // they are disabled. This is required for approval during review!
    disable() {
        dbg_log(`disabling ${Me.metadata.name}`);
        Main.activateWindow = this.origMethods["Main.activateWindow"];
        signal_disconnect_and_undefine(global.display, this.create_signal);
        signal_disconnect_and_undefine(global.display, this.focus_changed_signal);
        signal_disconnect_and_undefine(overview, this.hide_signal);

        // ↓ Do we really need these?
        // Logically these signals shouldn't be persistent at all.
        // Doing `for` loop can cause micro stutters on low-end device.
        // And gnome-shell tends to disable all extensions on lockscreen,
        // Then reenable then on unlock.
/*         for (const actor of global.get_window_actors()) {
            if (actor.is_destroyed()) {
                continue;
            }

            const win = actor.get_meta_window();
            if (win._mousefollowsfocus_extension_signal_demands_attention) {
                win.disconnect(win._mousefollowsfocus_extension_signal_demands_attention);
                delete win._mousefollowsfocus_extension_signal_demands_attention;
            }
            if (win._mousefollowsfocus_extension_signal_urgent) {
                win.disconnect(win._mousefollowsfocus_extension_signal_urgent);
                delete win._mousefollowsfocus_extension_signal_urgent;
            }
            if (win._mousefollowsfocus_extension_signal_focus) {
                win.disconnect(win._mousefollowsfocus_extension_signal_focus);
                delete win._mousefollowsfocus_extension_signal_focus;
            }
            if (win._mousefollowsfocus_extension_signal_unmanaged) {
                win.disconnect(win._mousefollowsfocus_extension_signal_unmanaged);
                delete win._mousefollowsfocus_extension_signal_unmanaged;
            }
        } */
    }
}


function init() {
    dbg_log(`initializing ${Me.metadata.name}`);

    return new Extension();
}

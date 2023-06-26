#! env -S make

NAME = mousefollowsfocus
UUID = $(NAME)@matthes.biz

.PHONY: build install enable disable test show remove clean trace


build:
	mkdir -p build/
	gnome-extensions pack --force --out-dir=build


deploy:
	gnome-extensions install --force build/$(UUID).shell-extension.zip


install: build remove deploy clean


test: install
	env GNOME_SHELL_SLOWDOWN_FACTOR=2 \
		MUTTER_DEBUG_DUMMY_MODE_SPECS=1200x1000 \
	 	MUTTER_DEBUG_DUMMY_MONITOR_SCALES=1 \
		dbus-run-session -- gnome-shell --nested --wayland


monitor:
	echo '[Ctrl]+[c] for interrupting this output'
	which journalctl && journalctl -f -o cat /usr/bin/gnome-shell


info:
	gnome-extensions info $(UUID)


enable: install
	gnome-extensions enable $(UUID)


disable:
	gnome-extensions disable $(UUID)


remove:
	rm -rf $(HOME)/.local/share/gnome-shell/extensions/$(UUID)


clean:
	rm -rf build/ po/*.mo

## End of Makefile ##

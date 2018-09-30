/***********************************************************************
 * Copyright (C) 2015-2018 Foivos S. Zakkak <foivos@zakkak.net>        *
 * Copyright (C) 2012-2014 Amy Chan <mathematical.coffee@gmail.com>    *
 *                                                                     *
 * This program is free software: you can redistribute it and/or       *
 * modify it under the terms of the GNU General Public License as      *
 * published by the Free Software Foundation, either version 3 of the  *
 * License, or (at your option) any later version.                     *
 *                                                                     *
 * This program is distributed in the hope that it will be useful, but *
 * WITHOUT ANY WARRANTY; without even the implied warranty of          *
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU   *
 * General Public License for more details.                            *
 *                                                                     *
 * You should have received a copy of the GNU General Public License   *
 * along with this program.  If not, see                               *
 * <http://www.gnu.org/licenses/>.                                     *
 ***********************************************************************/

/*global global, log */ // <-- jshint
/** Credit:
 *  taken from the gnome shell extensions repository at
 *  git.gnome.org/browse/gnome-shell-extensions
 */

const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Gettext = imports.gettext.domain("workspace-grid");
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

var KEY_ROWS = "num-rows";
var KEY_COLS = "num-columns";
var KEY_WRAPAROUND = "wraparound";
var KEY_WRAP_TO_SAME = "wrap-to-same";
var KEY_WRAP_TO_SAME_SCROLL = "wrap-to-same-scroll";
var KEY_MAX_HFRACTION = "max-screen-fraction";
var KEY_MAX_HFRACTION_COLLAPSE = "max-screen-fraction-before-collapse";
var KEY_SHOW_WORKSPACE_LABELS = "show-workspace-labels";
var KEY_RELATIVE_WORKSPACE_SWITCHING = "relative-workspace-switching";
var KEY_SCROLL_DIRECTION = "scroll-direction";

function init() {
    Convenience.initTranslations();
}

function LOG(msg) {
    //log(msg);
}

const WorkspaceGridPrefsWidget = GObject.registerClass(
    class WorkspaceGridPrefsWidget extends Gtk.Grid {
        _init(params) {
            super._init(params);
            this.margin = this.row_spacing = this.column_spacing = 10;
            this._rownum = 0;
            this._settings = Convenience.getSettings(
                "org.gnome.shell.extensions.workspace-grid"
            );
            // we use this to throttle the number of 'value-changed' signals that
            // are re-transmitted as settings changes, because when the user uses
            // a Gtk.Scale I get a signal for every single change of value including
            // where the user grabs the handle, drags it, and drops it (I get signals
            // for all the in-between values too where I just want the signal for
            // the end value).
            this._throttlers = {};

            let item = new Gtk.Label({
                label: _(
                    "NOTE: Please set Workspace Creation to Static. Also, note that the maximum number of workspaces is 36."
                )
            });
            item.set_line_wrap(true);
            this.addItem(item, 0, 2, 1);

            this.addSpin(
                _("Number of rows of workspaces:"),
                KEY_ROWS,
                true,
                1,
                36,
                1
            );

            this.addSpin(
                _("Number of columns of workspaces:"),
                KEY_COLS,
                true,
                1,
                36,
                1
            );

            this.addBoolean(
                _("Relative (to current row) workspace switching?"),
                KEY_RELATIVE_WORKSPACE_SWITCHING
            );
            let toggle = this.addBoolean(
                _("Wraparound workspaces when navigating?"),
                KEY_WRAPAROUND
            );
            this._sameRowCol = this.addBoolean(
                _(
                    " ... and wrap to the same row/col (as opposed to the next/previous)?"
                ),
                KEY_WRAP_TO_SAME
            );
            this._sameRowColScroll = this.addBoolean(
                _("     ... wrap to same also for mouse scrolling?"),
                KEY_WRAP_TO_SAME_SCROLL
            );
            this._sameRowColScroll.set_sensitive(this._sameRowCol.active);
            toggle.connect(
                "notify::active",
                Lang.bind(this, function(widget) {
                    this._sameRowCol.set_sensitive(widget.active);
                })
            );
            this._sameRowCol.connect(
                "notify::active",
                Lang.bind(this, function(widget) {
                    this._sameRowColScroll.set_sensitive(widget.active);
                })
            );

            this.addBoolean(
                _("Show workspace labels in the switcher?"),
                KEY_SHOW_WORKSPACE_LABELS
            );

            this.addTextComboBox("Scroll Direction: ", KEY_SCROLL_DIRECTION, [
                { name: "Horizontal", value: "horizontal" },
                { name: "Vertical", value: "vertical" }
            ]);

            item = new Gtk.Label({
                label: _(
                    "The following settings determine how much horizontal " +
                        "space the workspaces box\n in the overview can take up, " +
                        "as a fraction of the screen width."
                )
            });
            item.set_line_wrap(true);
            this.addItem(item, 0, 2, 1);

            this.addScale(
                _("Maximum width (fraction):"),
                KEY_MAX_HFRACTION,
                0,
                1,
                0.05
            );
            this.addScale(
                _("Maximum width (fraction) before collapse:"),
                KEY_MAX_HFRACTION_COLLAPSE,
                0,
                1,
                0.05
            );
        }

        addBoolean(text, key) {
            let item = new Gtk.Switch({
                active: this._settings.get_boolean(key)
            });
            this._settings.bind(
                key,
                item,
                "active",
                Gio.SettingsBindFlags.DEFAULT
            );
            return this.addRow(text, item);
        }

        addRow(text, widget, wrap) {
            let label = new Gtk.Label({
                label: text,
                hexpand: true,
                halign: Gtk.Align.START
            });
            label.set_line_wrap(wrap || false);
            this.attach(label, 0, this._rownum, 1, 1); // col, row, colspan, rowspan
            this.attach(widget, 1, this._rownum, 1, 1);
            this._rownum++;
            return widget;
        }

        addSpin(text, key, is_int, lower, upper, increment) {
            /* Length cutoff item */
            let adjustment = new Gtk.Adjustment({
                lower: lower,
                upper: upper,
                step_increment: increment || 1
            });
            let spinButton = new Gtk.SpinButton({
                adjustment: adjustment,
                digits: is_int ? 0 : 2,
                snap_to_ticks: true,
                numeric: true
            });
            if (is_int) {
                spinButton.set_value(this._settings.get_int(key));
                spinButton.connect(
                    "value-changed",
                    Lang.bind(this, function(spin) {
                        let value = spinButton.get_value_as_int();
                        if (this._settings.get_int(key) !== value) {
                            this._settings.set_int(key, value);
                        }
                    })
                );
            } else {
                spinButton.set_value(this._settings.get_double(key));
                spinButton.connect(
                    "value-changed",
                    Lang.bind(this, function(spin) {
                        let value = spinButton.get_value();
                        if (this._settings.get_double(key) !== value) {
                            this._settings.set_double(key, value);
                        }
                    })
                );
            }
            return this.addRow(text, spinButton);
        }

        addScale(text, key, lower, upper, increment) {
            let hscale = Gtk.Scale.new_with_range(
                Gtk.Orientation.HORIZONTAL,
                lower,
                upper,
                increment
            );
            hscale.set_digits(2);
            hscale.set_hexpand(true);
            this._throttlers[key] = 0;

            // only send the _settings change for the *last* value-changed
            // if there are a string of them, e.g. for all the intermediate
            // values between drag-start and drag-end of the slider.
            const SCALE_THROTTLE_TIMEOUT = 500;
            hscale.set_value(this._settings.get_double(key));
            hscale.connect(
                "value-changed",
                Lang.bind(this, function() {
                    if (this._throttlers[key]) {
                        Mainloop.source_remove(this._throttlers[key]);
                    }
                    this._throttlers[key] = Mainloop.timeout_add(
                        SCALE_THROTTLE_TIMEOUT,
                        Lang.bind(this, function() {
                            let value = hscale.get_value();
                            if (this._settings.get_double(key) !== value) {
                                this._settings.set_double(key, value);
                            }
                            this._throttlers[key] = 0;
                            return false;
                        })
                    );
                })
            );
            return this.addRow(text, hscale, true);
        }

        addTextComboBox(text, key, options) {
            let item = new Gtk.ComboBoxText();
            let activeOption = 0;

            for (let i = 0; i < options.length; i++) {
                item.append_text(options[i].name);
                if (options[i].value === this._settings.get_string(key))
                    activeOption = i;
            }
            item.set_active(activeOption);

            item.connect(
                "changed",
                Lang.bind(this, function() {
                    let activeItem = item.get_active();
                    this._settings.set_string(key, options[activeItem].value);
                })
            );

            return this.addRow(text, item);
        }

        addItem(widget, col, colspan, rowspan) {
            this.attach(
                widget,
                col || 0,
                this._rownum,
                colspan || 2,
                rowspan || 1
            );
            this._rownum++;
        }
    }
);

function buildPrefsWidget() {
    let widget = new WorkspaceGridPrefsWidget();
    widget.show_all();

    return widget;
}

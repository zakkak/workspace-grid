/** Credit:
 *  taken from the gnome shell extensions repository at
 *  git.gnome.org/browse/gnome-shell-extensions
 */

const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;

const Gettext = imports.gettext.domain('workspace-grid');
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

function init() {
    Convenience.initTranslations();
}

function LOG(msg) {
    //log(msg);
}
/*
 * A Gtk.ListStore with the convenience of binding one of the columns to
 * a GSettings strv column.
 *
 * Modified from git.gnome.org/gnome-shell-extensions auto-move-windows prefs.js
 *
 * You must modifier to your own use. See '@@' for places to start editing.
 *
 * In particular, 'key' is the strv gsettings key, and 'keyColumnIndex' is the
 * column index we will get the values for this key from.
 *
 * When you add to/delete from the store (via .set), call store.lock().
 * If this returns true then the store has been successfully locked (against
 * further changes occuring whilst you make your changes).
 * If it returns 'false' the store was previously locked and you should not
 * make your changes.
 * When you're done, call store.unlock() to open it up again.
 */
const ListModel = new GObject.Class({
    Name: 'WorkspaceGrid.@CamelCaseExtensionName@ListModel',
    GTypeName: 'WorkspaceGridListModel',
    Extends: Gtk.ListStore,

    Columns: {
        COLNAME : [index] // @@ add your columns here
    },

    _init: function (settings, key, keyColumnIndex, params) {
        this.parent(params);
        this._settings = settings;
        this._strvKey = key;
        this.set_column_types( /* @@ add types here */ );
        this._keyColumnIndex = keyColumnIndex;
        this._preventChanges = false; // a lock.

        this._reloadFromSettings();

        this.connect('row-changed', Lang.bind(this, this._onRowChanged));
        this.connect('row-inserted', Lang.bind(this, this._onRowInserted));
        this.connect('row-deleted', Lang.bind(this, this._onRowDeleted));

    },

    /* attempt to lock the store, returning TRUE if we succeeded and FALSE
     * if it was already locked
     */
    lock: function () {
        if (this._preventChanges) {
            return false;
        }
        this._preventChanges = true;
        return true;
    },

    /* unlock the store to allow future changes */
    unlock: function () {
        this._preventChanges = false;
    },

    /* query whether the store is locked */
    is_locked: function () {
        return this._preventChanges;
    },

    _reloadFromSettings: function () {
        if (this.lock()) {
            let newNames = this._settings.get_strv(this._strvKey);
            let [ok, iter] = this.get_iter_first();
            while (ok) {
                ok = this.remove(iter);
            }

            for (let i = 0; i < newNames.length; i++) {
                iter = this.append();
                // @@ set other properties here if you like
                this.set(iter, [this._keyColumnIndex], [newNames[i]]);
            }
            this.unlock();
        }
    },

    _onRowChanged: function (self, path, iter) {
        if (this.lock()) {
            LOG('changing row');
            let index = path.get_indices()[0],
                names = this._settings.get_strv(this._strvKey);
            // @@if you want to fill in gaps with blanks:
            if (index >= names.length) {
                // fill with blanks
                for (let i = names.length; i <= index; i++) {
                    names[i] = '';
                }
            }
            // otherwise (skip blanks, append to end):
            // index = Math.min(index, names.length);
            names[index] = this.get_value(iter, this._keyColumnIndex);

            this._settings.set_strv(this._strvKey, names);
            this.unlock();
        } else {
            LOG('tried to change row but it was locked');
        }
    },

    _onRowInserted: function(self, path, iter) {
        if (this.lock()) {
            LOG('inserting row');
            let index = path.get_indices()[0];
            let names = this._settings.get_strv(this._strvKey);
            let label = this.get_value(iter, this._keyColumnIndex) || '';
            names.splice(index, 0, label);

            this._settings.set_strv(this._strvKey, names);
            this.unlock();
        } else {
            LOG('tried to insert row but it was locked');
        }
    },

    _onRowDeleted: function(self, path) {
        if (this.lock()) {
            LOG('deleting row');
            let index = path.get_indices()[0];
            let names = this._settings.get_strv(this._strvKey);

            if (index >= names.length) {
                return;
            }

            names.splice(index, 1);

            // compact the array
            for (let i = names.length -1; i >= 0 && !names[i]; i++) {
                names.pop();
            }

            this._settings.set_strv(this._strvKey, names);

            this.unlock();
        } else {
            LOG('tried to delete row but it was locked');
        }
    }
});

const WorkspaceGridPrefsWidget = new GObject.Class({
    Name: 'WorkspaceGrid.Prefs.Widget',
    GTypeName: 'WorkspaceGridPrefsWidget',
    Extends: Gtk.Grid,

    _init: function(params) {
        this.parent(params);
        this.margin = this.row_spacing = this.column_spacing = 10;
        this._rownum = 0;
        this._settings = Convenience.getSettings();

        let entry = new Gtk.Entry({ hexpand: true });
        this._settings.bind('hello-text', entry, 'text', Gio.SettingsBindFlags.DEFAULT);
        this.addRow(_("Message:"), entry);

        this.addBoolean('My boolean setting', BOOLEAN_SETTING_KEY);

        /* Treeview example, an icon + text with the strv key being STRV_KEY */
        this._store = new ListModel(this._settings, STRV_KEY, ListModel.prototype.Columns.STRV_COLUMN);
        this._treeView = new Gtk.TreeView({
            model: this._store,
            hexpand: true,
            vexpand: true,
            headers_visible: true,
            reorderable: true
        });
        this._treeView.get_selection().set_mode(Gtk.SelectionMode.SINGLE);

        // add one column to the tree view being the icon + the text.
        let col = new Gtk.TreeViewColumn({
            title: _("My Column Title"),
            sort_column_id: this._store.Columns.NAME
        });
        // To show anything you have to instantiate a renderer, bind it
        //  to one of the columns in the store, and then add to the column.
        let iconRenderer = new Gtk.CellRendererPixbuf(),
            textRenderer = new Gtk.CellRendererText({ editable: false });
        col.pack_start(iconRenderer, false); // add to column
        col.pack_start(textRenderer, true);
        // bind to store
        col.add_attribute(iconRenderer, 'gicon', this._store.Columns.ICON);
        col.add_attribute(textRenderer, 'text', this._store.Columns.NAME);

        // add column to tree view
        this._treeView.append_column(col);

        // add tree view to widget
        this.addItem(this._treeView);

        /* Now add a toolbar with 'add' and 'delete' for the treeview */
        let toolbar = new Gtk.Toolbar();
        toolbar.get_style_context().add_class(Gtk.STYLE_CLASS_INLINE_TOOLBAR);

        let newButton = new Gtk.ToolButton({ stock_id: Gtk.STOCK_NEW });
        newButton.connect('clicked', Lang.bind(this, this._newClicked));
        toolbar.add(newButton);

        let delButton = new Gtk.ToolButton({ stock_id: Gtk.STOCK_DELETE });
        delButton.connect('clicked', Lang.bind(this, this._delClicked));
        toolbar.add(delButton);

        this.addItem(toolbar);


    },

    addBoolean: function (text, key) {
        let item = new Gtk.Switch({active: this._settings.get_boolean(key)});
        this._settings.bind(key, item, 'active', Gio.SettingsBindFlags.DEFAULT);
        this.addRow(text, item);
    },

    addRow: function (text, widget, wrap) {
        let label = new Gtk.Label({ label: text });
        label.set_line_wrap(wrap || false);
        this.attach(label, 0, this._rownum, 1, 1); // col, row, colspan, rowspan
        this.attach(widget, 1, this._rownum, 1, 1);
        this._rownum++;
    },

    addItem: function (widget, col, colspan, rowspan) {
        this.attach(widget, col || 0, this._rownum, colspan || 2, rowspan || 1);
        this._rownum++;
    },

    /* add/delete from treeView */
    _newClicked: function() {
        let iter = this._store.append();
        // POPULATE THIS:
        this._store.set(iter, [this._store.Columns.NAMES], [values]);
    },

    _delClicked: function() {
        let [any, model, iter] = this._treeView.get_selection().get_selected();

        if (any) {
            this._store.remove(iter);
        }
    }
});

function buildPrefsWidget() {
    let widget = new WorkspaceGridPrefsWidget();
    widget.show_all();

    return widget;
}

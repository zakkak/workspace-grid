/*global global, log */ // <-- jshint
/*jshint unused: true, maxlen: 150 */
/* Workspaces Grid GNOME shell extension.
 *
 * mathematical.coffee <mathematical.coffee@gmail.com>
 *
 * Inspired by Frippery Static Workspaces[0] by R. M. Yorston
 *
 * [0]: https://extensions.gnome.org/extension/12/static-workspaces/
 *
 * ----------------------------------------------------
 * Notes for other developers
 * --------------------------
 * If you wish to see if your extension is compatible with this, note:
 *
 * This extension exports a number of constants and functions to an object
 * global.screen.workspace_grid for your convenience. Note that this extension
 * must be enabled for this all to work. global.screen.workspace_grid contains:
 *
 *   (Exported Constants)
 *   - Directions = { UP, LEFT, RIGHT, DOWN } : directions for navigating (see
 *                                              moveWorkspaces further down)
 *     (NOTE: for 3.6+ you can just use Meta.MotionDirection.{UP,LEFT,RIGHT,DOWN})
 *   - rows     : number of rows of workspaces
 *   - columns  : number of columns of workspaces
 *
 *   (Exported Functions)
 *   - moveWorkspace : switches workspaces in the direction specified, being
 *                     either UP, LEFT, RIGHT or DOWN (see Directions).
 *   - rowColToIndex : converts the row/column into an index for use with (e.g.)
 *                     global.screen.get_workspace_by_index(i)
 *   - indexToRowCol : converts an index (0 to global.screen.n_workspaces-1) to
 *                     a row and column
 *   - getWorkspaceSwitcherPopup : gets our workspace switcher popup so you
 *                                 can show it if you want
 *   - calculateWorkspace : returns the workspace index in the specified direction
 *                          to the current, taking into account wrapping.
 *
 * For example, to move to the workspace below us:
 *     const WorkspaceGrid = global.screen.workspace_grid;
 *     WorkspaceGrid.moveWorkspace(WorkspaceGrid.Directions.DOWN);
 *
 * I am happy to try help/give an opinion/improve this extension to try make it
 *  more compatible with yours, email me :)
 *
 * Listening to workspace_grid
 * ---------------------------
 * Say you want to know the number of rows/columns of workspaces in your
 * extension. Then you have to wait for this extension to load and populate
 * global.screen.workspace_grid.
 *
 * When the workspace_grid extension enables or disables it fires a
 *  'notify::n_workspaces' signal on global.screen.
 *
 * You can connect to this and check for the existence (or removal) of
 * global.screen.workspace_grid.
 *
 * Further notes
 * -------------
 * Workspaces can be changed by the user by a number of ways, and this extension
 * aims to cover them all:
 * - keybinding (wm.setKeybindingHandler)
 * - keybinding with global grab in progress (e.g. in Overview/lg): see
 *    Main._globalKeyPressHandler
 * - scrolling in the overview (WorkspacesView.WorkspacesDisplay._onScrollEvent)
 * - clicking in the overview.
 *
 * Dev notes for this extension
 * ----------------------------
 * From GNOME 3.4+ to keep workspaces static we can just do:
 * - org.gnome.shell.overrides.dynamic-workspaces false
 * - org.gnome.desktop.wm.preferences.num-workspaces <numworkspaces>
 * However then you can't drag/drop applications between workspaces (GNOME 3.4.1
 * anyway)
 *
 * Hence we make use of the Frippery Static Workspace code.
 *
 * See also the edited workspaces indicator
 * http://kubiznak-petr.ic.cz/en/workspace-indicator.php (this is column-major).
 *
 * GNOME 3.2 <-> GNOME 3.4
 * -----------------------
 * - Main.wm.setKeybindingHandler -> Meta.keybindings_set_custom_handler
 * - keybinding names '_' -> '-'
 * - keybinding callback: wm, binding, mask, window, backwards ->
 *    display, screen, window, binding
 * - keybinding callback: binding -> binding.get_name()
 * - destroy_children <-> destroy_all_children
 * - In 3.4 thumbnails box has a dropPlaceholder for dropping windows into new
 *   workspaces
 *
 * GNOME 3.4 <-> GNOME 3.6
 * ---------
 * - WorkspaceSwitcherPopup gets *destroyed* every time it disappears
 * - Main.overview._workspacesDisplay -> Main.overview._viewSelector._workspacesDisplay
 * - The old WorkspaceSwitcherPopup _redraw + _position combined into _redisplay.
 * - Directions instead of being 'switch-to-workspace-*' are now Meta.MotionDirection
 * - The workspace popup also shows for 'move-to-workspace-*' binings.
 * - actionMoveWorkspace{Up,Down} --> actionMoveWorkspace
 */

////////// CODE ///////////
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const DND = imports.ui.dnd;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const WindowManager = imports.ui.windowManager;
const WorkspaceSwitcher = imports.ui.workspaceSwitcherPopup;
const WorkspaceThumbnail = imports.ui.workspaceThumbnail;
const WorkspacesView = imports.ui.workspacesView;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Prefs = Me.imports.prefs;

const KEY_ROWS = Prefs.KEY_ROWS;
const KEY_COLS = Prefs.KEY_COLS;
const KEY_WRAPAROUND = Prefs.KEY_WRAPAROUND;
const KEY_MAX_HFRACTION = Prefs.KEY_MAX_HFRACTION;
const KEY_MAX_HFRACTION_COLLAPSE = Prefs.KEY_MAX_HFRACTION_COLLAPSE;
const KEY_SHOW_WORKSPACE_LABELS = Prefs.KEY_SHOW_WORKSPACE_LABELS;

// laziness
const UP = Meta.MotionDirection.UP;
const DOWN = Meta.MotionDirection.DOWN;
const LEFT = Meta.MotionDirection.LEFT;
const RIGHT = Meta.MotionDirection.RIGHT;
const Keybindings = {
    UP: 'switch-to-workspace-up',
    DOWN: 'switch-to-workspace-down',
    LEFT: 'switch-to-workspace-left',
    RIGHT: 'switch-to-workspace-right'
};
const BindingToDirection = {
    'switch-to-workspace-up': UP,
    'switch-to-workspace-down': DOWN,
    'switch-to-workspace-left': LEFT,
    'switch-to-workspace-right': RIGHT,
    'move-to-workspace-up': UP,
    'move-to-workspace-down': DOWN,
    'move-to-workspace-left': LEFT,
    'move-to-workspace-right': RIGHT
};
/* it seems the max number of workspaces is 36
 * (MAX_REASONABLE_WORKSPACES in mutter/src/core/prefs.c)
 */
const MAX_WORKSPACES = 36;

/* Import some constants from other files and also some laziness */
const MAX_THUMBNAIL_SCALE = WorkspaceThumbnail.MAX_THUMBNAIL_SCALE;
const WORKSPACE_CUT_SIZE = WorkspaceThumbnail.WORKSPACE_CUT_SIZE;
const ThumbnailState = WorkspaceThumbnail.ThumbnailState;
const WMProto = WindowManager.WindowManager.prototype;

/* storage for the extension */
let staticWorkspaceStorage = {};
let wmStorage = {};
let nWorkspaces;
let _workspaceSwitcherPopup = null;
//let globalKeyPressHandler = null;
let thumbnailsBox = null;
let onScrollId = 0;
let settings = 0;

/***************
 * Helper functions
 ***************/
/* Converts an index (from 0 to global.screen.n_workspaces) into [row, column]
 * being the row and column of workspace `index` according to the user's layout.
 *
 * Row and column start from 0.
 */
function indexToRowCol(index) {
    // row-major. 0-based.
    return [Math.floor(index / global.screen.workspace_grid.columns),
       index % global.screen.workspace_grid.columns];
}

/* Converts a row and column (0-based) into the index of that workspace.
 *
 * If the resulting index is greater than MAX_WORKSPACES (the maximum number
 * of workspaces allowable by Mutter), it will return -1.
 */
function rowColToIndex(row, col) {
    // row-major. 0-based.
    let idx = row * global.screen.workspace_grid.columns + col;
    if (idx >= MAX_WORKSPACES) {
        idx = -1;
    }
    return idx;
}

/** Gets the workspace switcher popup, creating if it doesn't exist. */
function getWorkspaceSwitcherPopup() {
    if (!_workspaceSwitcherPopup) {
        _workspaceSwitcherPopup = new WorkspaceSwitcherPopup();
        // just in case.
        Main.wm._workspaceSwitcherPopup = _workspaceSwitcherPopup;
        // in GNOME 3.6 instead of storing the popup for next time, it's
        // destroyed every single time it fades out..
        _workspaceSwitcherPopup.connect('destroy', function () {
            _workspaceSwitcherPopup = null;
            Main.wm._workspaceSwitcherPopup = null;
        });
    }
    return _workspaceSwitcherPopup;
}

// calculates the workspace index in that direction.
function calculateWorkspace(direction, wraparound) {
    let from = global.screen.get_active_workspace_index(),
        [row, col] = indexToRowCol(from),
        to;

    switch (direction) {
    case LEFT:
        col = Math.max(0, col - 1);
        break;
    case RIGHT:
        col = Math.min(global.screen.workspace_grid.columns - 1, col + 1);
        break;
    case UP:
        row = Math.max(0, row - 1);
        break;
    case DOWN:
        row = Math.min(global.screen.workspace_grid.rows - 1, row + 1);
        break;
    }
    to = rowColToIndex(row, col);
    if (to < 0) { // if we tried to move to a workspace after MAX_WORKSPACES
        to = (wraparound ? 0 : from);
    } else if (to === from && wraparound) {
        // depends on the direction of scroll.
        if (to === 0) {
            to = global.screen.n_workspaces - 1;
        } else if (to === global.screen.n_workspaces - 1) {
            to = 0;
        } else if (direction === LEFT) {
            // if to === from, we must be at the start of the row.
            // Go to the end of the previous row.
            to -= 1;
        } else if (direction === RIGHT) {
            // if to === from, we must be at the start of the row.
            // Go to the start of the next row.
            to += 1;
        } else if (direction === UP) {
            // if to === from, we must be at the start of the column.
            // Go to the end of the previous column.
            to = rowColToIndex(global.screen.workspace_grid.rows - 1, col - 1);
        } else if (direction === DOWN) {
            // if to === from, we must be at the end of the column.
            // Go to the start of the next column.
            to = rowColToIndex(0, col + 1);
        }
    }
    return to;
}


/* Switch to the appropriate workspace, showing the workspace switcher.
 * direction is either UP, LEFT, RIGHT or DOWN.
 *
 * This can occur through:
 * - keybinding (wm.setKeybindingHandler)
 * - keybinding with global grab in progress (e.g. Overview/lg)
 * - scrolling/clicking in the overview
 * - (other extensions, e.g. navigate with up/down arrows:
 *        https://extensions.gnome.org/extension/29/workspace-navigator/)
 */
function moveWorkspace(direction, wraparound) {
        let from = global.screen.get_active_workspace_index(),
        to = calculateWorkspace(direction, wraparound);

    //log('moving from workspace %d to %d'.format(from, to));
    if (to !== from) {
        global.screen.get_workspace_by_index(to).activate(
                global.get_current_time());
    }

    // show workspace switcher
    if (!Main.overview.visible) {
        getWorkspaceSwitcherPopup().display(direction, to);
    }
}

// GNOME 3.6: _redraw --> _redisplay
/************
 * Workspace Switcher that can do rows and columns as opposed to just rows.
 ************/
const WorkspaceSwitcherPopup = new Lang.Class({
    Name: 'WorkspaceSwitcherPopup',
    Extends: WorkspaceSwitcher.WorkspaceSwitcherPopup,

    // note: this makes sure everything fits vertically and then adjust the
    // horizontal to fit.
    _getPreferredHeight : function (actor, forWidth, alloc) {
        let children = this._list.get_children(),
            primary = Main.layoutManager.primaryMonitor,
            nrows = global.screen.workspace_grid.rows,
            availHeight = primary.height,
            height = 0,
            spacing = this._itemSpacing * (nrows - 1);

        availHeight -= Main.panel.actor.height;
        availHeight -= this.actor.get_theme_node().get_vertical_padding();
        availHeight -= this._container.get_theme_node().get_vertical_padding();
        availHeight -= this._list.get_theme_node().get_vertical_padding();

        for (let i = 0; i < global.screen.n_workspaces;
                i += global.screen.workspace_grid.columns) {
            let [childMinHeight, childNaturalHeight] =
                children[i].get_preferred_height(-1);
            children[i].get_preferred_width(childNaturalHeight);
            height += childNaturalHeight * primary.width / primary.height;
        }

        height += spacing;

        height = Math.min(height, availHeight);
        this._childHeight = (height - spacing) / nrows;

        // check for horizontal overflow and adjust.
        let childHeight = this._childHeight;
        this._getPreferredWidth(actor, -1, {});
        if (childHeight !== this._childHeight) {
            // the workspaces will overflow horizontally and ._childWidth &
            // ._childHeight have been adjusted to make it fit.
            height = this._childHeight * nrows + spacing;
            if (height > availHeight) {
                this._childHeight = (availHeight - spacing) / nrows;
            }
        }

        alloc.min_size = height;
        alloc.natural_size = height;
    },

    _getPreferredWidth : function (actor, forHeight, alloc) {
        let primary = Main.layoutManager.primaryMonitor,
            ncols = global.screen.workspace_grid.columns;
        this._childWidth = this._childHeight * primary.width / primary.height;
        let width = this._childWidth * ncols + this._itemSpacing * (ncols - 1),
            padding = this.actor.get_theme_node().get_horizontal_padding() +
                      this._list.get_theme_node().get_horizontal_padding() +
                      this._container.get_theme_node().get_horizontal_padding();

        // but constrain to at most primary.width
        if (width + padding > primary.width) {
            this._childWidth = (primary.width - padding -
                                this._itemSpacing * (ncols - 1)) / ncols;
            this._childHeight = this._childWidth * primary.height /
                                primary.width;
            width = primary.width - padding;
        }

        alloc.min_size = width;
        alloc.natural_size = width;
    },

    _allocate : function (actor, box, flags) {
        let children = this._list.get_children(),
            childBox = new Clutter.ActorBox(),
            x = box.x1,
            y = box.y1,
            prevX = x,
            prevY = y,
            i = 0;
        for (let row = 0; row < global.screen.workspace_grid.rows; ++row) {
            x = box.x1;
            prevX = x;
            for (let col = 0; col < global.screen.workspace_grid.columns; ++col) {
                childBox.x1 = prevX;
                childBox.x2 = Math.round(x + this._childWidth);
                childBox.y1 = prevY;
                childBox.y2 = Math.round(y + this._childHeight);

                x += this._childWidth + this._itemSpacing;
                prevX = childBox.x2 + this._itemSpacing;
                children[i].allocate(childBox, flags);
                i++;
                if (i >= MAX_WORKSPACES) {
                    break;
                }
            }
            if (i >= MAX_WORKSPACES) {
                break;
            }
            prevY = childBox.y2 + this._itemSpacing;
            y += this._childHeight + this._itemSpacing;
        }
    },

    // GNOME 3.6: old _redraw + _position is now combined into _redisplay
    // Also, workspace switcher is *destroyed* whenever it fades out.
    // Previously it was stored.
    _redisplay: function () {
        //log('redisplay, direction ' + this._direction + ', going to ' + this._activeWorkspaceIndex);
        this._list.destroy_all_children();

        for (let i = 0; i < global.screen.n_workspaces; i++) {
            let indicator = null;
            let name = Meta.prefs_get_workspace_name(i);

            if (i === this._activeWorkspaceIndex &&
                   this._direction === UP) {
                indicator = new St.Bin({
                    style_class: 'ws-switcher-active-up'
                });
            } else if (i === this._activeWorkspaceIndex &&
                   this._direction === DOWN) {
                indicator = new St.Bin({
                    style_class: 'ws-switcher-active-down'
                });
            } else if (i === this._activeWorkspaceIndex &&
                   this._direction === LEFT) {
                indicator = new St.Bin({
                    style_class: 'ws-switcher-active-left'
                });
            } else if (i === this._activeWorkspaceIndex &&
                   this._direction === RIGHT) {
                indicator = new St.Bin({
                    style_class: 'ws-switcher-active-right'
                });
            } else {
                indicator = new St.Bin({style_class: 'ws-switcher-box'});
            }
            if (settings.get_boolean(KEY_SHOW_WORKSPACE_LABELS) && i !== this._activeWorkspaceIndex) {
                indicator.child = new St.Label({
                    text: name,
                    style_class: 'ws-switcher-label'
                });
            }

            this._list.add_actor(indicator);
        }

        let primary = Main.layoutManager.primaryMonitor;
        let [containerMinHeight, containerNatHeight] = this._container.get_preferred_height(global.screen_width);
        let [containerMinWidth, containerNatWidth] = this._container.get_preferred_width(containerNatHeight);
        this._container.x = primary.x + Math.floor((primary.width - containerNatWidth) / 2);
        this._container.y = primary.y + Main.panel.actor.height +
                            Math.floor(((primary.height - Main.panel.actor.height) - containerNatHeight) / 2);
    }

});

/* Keybinding handler.
 * Should bring up a workspace switcher.
 * Either activates the target workspace or if it's move-to-workspace-xxx
 * we should move the window as well as show the workspace switcher.
 * This is the same as WindowManager._showWorkspaceSwitcher but we don't
 * filter out RIGHT/LEFT actions like they do.
 */
function showWorkspaceSwitcher(display, screen, window, binding) {
    if (global.screen.n_workspaces === 1)
        return;

    let direction = BindingToDirection[binding.get_name()],
        to;
    if (binding.get_name().substr(0, 5) === 'move-') {
        to = Main.wm.actionMoveWindow(window, direction); // we've patched ths
    } else {
        // we've patched this
        to = Main.wm.actionMoveWorkspace(direction);
    }

    // show workspace switcher
    if (!Main.overview.visible) {
        getWorkspaceSwitcherPopup().display(direction, to.index());
    }
}

/******************
 * Overrides the 'switch_to_workspace_XXX' keybindings
 ******************/
function overrideKeybindingsAndPopup() {
    // note - we could simply replace Main.wm._workspaceSwitcherPopup and
    // not bother with taking over the keybindings, if not for the 'wraparound'
    // stuff.
    Meta.keybindings_set_custom_handler(Keybindings.LEFT, showWorkspaceSwitcher);
    Meta.keybindings_set_custom_handler(Keybindings.RIGHT, showWorkspaceSwitcher);
    Meta.keybindings_set_custom_handler(Keybindings.UP, showWorkspaceSwitcher);
    Meta.keybindings_set_custom_handler(Keybindings.DOWN, showWorkspaceSwitcher);
    // added for 3.6 @@
    Meta.keybindings_set_custom_handler('move-to-workspace-left', showWorkspaceSwitcher);
    Meta.keybindings_set_custom_handler('move-to-workspace-right', showWorkspaceSwitcher);
    Meta.keybindings_set_custom_handler('move-to-workspace-up', showWorkspaceSwitcher);
    Meta.keybindings_set_custom_handler('move-to-workspace-down', showWorkspaceSwitcher);

    // make sure our keybindings work when (e.g.) overview is open too.
    // For some reason in 3.6 it appears this doesn't affect the callback,
    // even though it's just a global.stage.connect and not a Lang.bind and
    // this worked in 3.2-3.4
    // So instead of overriding we'll just add our own handler.
    //globalKeyPressHandler = Main._globalKeyPressHandler;
    global.stage.connect('captured-event', function (actor, event) {
        // same as _globalKeyPressHandler
        if (Main.modalCount === 0 ||
                event.type() !== Clutter.EventType.KEY_PRESS) {
            return false;
        }

        if (!Main.sessionMode.allowKeybindingsWhenModal) {
            if (Main.modalCount > (Main.overview.visible ? 1 : 0))
                return false;
        }

        let keyCode = event.get_key_code(),
            ignoredModifiers = global.display.get_ignored_modifier_mask(),
            modifierState = event.get_state() & ~ignoredModifiers,
            action = global.display.get_keybinding_action(keyCode,
                    modifierState);

        // UP and DOWN are already handled by the original
        // Main._globalKeyPressHandler and call actionMoveWorkspace which
        // we've patched.
        // We just grab RIGHT and LEFT.
        switch (action) {
        case Meta.KeyBindingAction.WORKSPACE_LEFT:
            if (!Main.sessionMode.hasWorkspaces) {
                return false;
            }
            moveWorkspace(LEFT, settings.get_boolean(KEY_WRAPAROUND));
            return true;
        case Meta.KeyBindingAction.WORKSPACE_RIGHT:
            if (!Main.sessionMode.hasWorkspaces) {
                return false;
            }
            moveWorkspace(RIGHT, settings.get_boolean(KEY_WRAPAROUND));
            return true;
        }
    });

    // Override imports.ui.windowManager.actionMove* just in case other
    // extensions use them.
    wmStorage.actionMoveWorkspace = WMProto.actionMoveWorkspace;
    WMProto.actionMoveWorkspace = function (direction) {
        let from = global.screen.get_active_workspace_index(),
            to = calculateWorkspace(direction, settings.get_boolean(KEY_WRAPAROUND)),
            ws = global.screen.get_workspace_by_index(to);

        if (to !== from) {
            ws.activate(global.get_current_time());
        }
        return ws;
    };
    wmStorage.actionMoveWindow = WMProto.actionMoveWindow;
    WMProto.actionMoveWindow = function (window, direction) {
        let to = calculateWorkspace(direction,
                settings.get_boolean(KEY_WRAPAROUND)),
            ws = global.screen.get_workspace_by_index(to);

        if (to !== global.screen.get_active_workspace_index()) {
            Main.wm._movingWindow = window;
            window.change_workspace(ws);
            global.display.clear_mouse_mode();
            ws.activate_with_focus(window, global.get_current_time());
        }
        return ws;
    };
}

/* Restore the original keybindings */
function unoverrideKeybindingsAndPopup() {
    // Restore t
    Meta.keybindings_set_custom_handler(Keybindings.LEFT, Lang.bind(Main.wm,
                Main.wm._showWorkspaceSwitcher));
    Meta.keybindings_set_custom_handler(Keybindings.RIGHT, Lang.bind(Main.wm,
                Main.wm._showWorkspaceSwitcher));
    Meta.keybindings_set_custom_handler(Keybindings.UP, Lang.bind(Main.wm,
                Main.wm._showWorkspaceSwitcher));
    Meta.keybindings_set_custom_handler(Keybindings.DOWN, Lang.bind(Main.wm,
                Main.wm._showWorkspaceSwitcher));
    // added for 3.6 @@
    Meta.keybindings_set_custom_handler('move-to-workspace-left', Lang.bind(Main.wm,
                Main.wm._showWorkspaceSwitcher));
    Meta.keybindings_set_custom_handler('move-to-workspace-right', Lang.bind(Main.wm,
                Main.wm._showWorkspaceSwitcher));
    Meta.keybindings_set_custom_handler('move-to-workspace-up', Lang.bind(Main.wm,
                Main.wm._showWorkspaceSwitcher));
    Meta.keybindings_set_custom_handler('move-to-workspace-down', Lang.bind(Main.wm,
                Main.wm._showWorkspaceSwitcher));

    //Main._globalKeyPressHandler = globalKeyPressHandler;

    _workspaceSwitcherPopup = null;

    WMProto.actionMoveWorkspace = wmStorage.actionMoveWorkspace;
    WMProto.actionMoveWindow = wmStorage.actionMoveWindow;
}

// GNOME 3.2 & 3.4: Main.overview._workspacesDisplay
// GNOME 3.6: Main.overview._viewSelector._workspacesDisplay
function _getWorkspaceDisplay() {
    return Main.overview._workspacesDisplay || Main.overview._viewSelector._workspacesDisplay;
}

/******************
 * Overrides the workspaces display in the overview
 ******************/
const ThumbnailsBox = new Lang.Class({
    Name: 'ThumbnailsBox',
    Extends: WorkspaceThumbnail.ThumbnailsBox,

    /**
     * The following are overridden simply to incorporate ._indicatorX in the
     * same way as ._indicatorY
     **/
    _init: function () {
        // Note: we could just call this.parent(); this._inicatorX = 0; but
        // instead we replicate this.parent()'s code here so we can store
        // the signal IDs (it connects to Main.overview) so that we can delete
        // them properly on destroy!

        //this.parent(); Equivalent to:
        this.actor = new Shell.GenericContainer({
            reactive: true,
            style_class: 'workspace-thumbnails',
            request_mode: Clutter.RequestMode.WIDTH_FOR_HEIGHT
        });
        this.actor.connect('get-preferred-width',
            Lang.bind(this, this._getPreferredWidth));
        this.actor.connect('get-preferred-height',
                Lang.bind(this, this._getPreferredHeight));
        this.actor.connect('allocate', Lang.bind(this, this._allocate));
        this.actor._delegate = this;

        this._background = new St.Bin({
            style_class: 'workspace-thumbnails-background'
        });

        this.actor.add_actor(this._background);

        let indicator = new St.Bin({
            style_class: 'workspace-thumbnail-indicator'
        });

        // We don't want the indicator to affect drag-and-drop
        Shell.util_set_hidden_from_pick(indicator, true);

        this._indicator = indicator;
        this.actor.add_actor(indicator);

        this._dropWorkspace = -1;
        this._dropPlaceholderPos = -1;
        this._dropPlaceholder = new St.Bin({ style_class: 'placeholder' });
        this.actor.add_actor(this._dropPlaceholder);

        this._targetScale = 0;
        this._scale = 0;
        this._pendingScaleUpdate = false;
        this._stateUpdateQueued = false;
        this._animatingIndicator = false;
        this._indicatorY = 0; // only used when _animatingIndicator is true

        this._stateCounts = {};
        for (let key in ThumbnailState) {
            if (ThumbnailState.hasOwnProperty(key)) {
                this._stateCounts[ThumbnailState[key]] = 0;
            }
        }

        this._thumbnails = [];

        this.actor.connect('button-press-event', function () { return true; });
        this.actor.connect('button-release-event',
                Lang.bind(this, this._onButtonRelease));

        // Change: STORE these signals so we can disconnect on destroy.
        this._signals = [];
        this._signals.push(Main.overview.connect('item-drag-begin',
              Lang.bind(this, this._onDragBegin)));
        this._signals.push(Main.overview.connect('item-drag-end',
              Lang.bind(this, this._onDragEnd)));
        this._signals.push(Main.overview.connect('item-drag-cancelled',
              Lang.bind(this, this._onDragCancelled)));
        this._signals.push(Main.overview.connect('window-drag-begin',
              Lang.bind(this, this._onDragBegin)));
        this._signals.push(Main.overview.connect('window-drag-end',
              Lang.bind(this, this._onDragEnd)));
        this._signals.push(Main.overview.connect('window-drag-cancelled',
              Lang.bind(this, this._onDragCancelled)));

        // end this.parent()

        this._indicatorX = 0; // to match indicatorY
        this._dropPlaceholderHorizontal = true;
    },

    /* when the user clicks on a thumbnail take into account the x position
     * of that thumbnail as well as the y to determine which was clicked */
    _onButtonRelease: function (actor, event) {
        let [stageX, stageY] = event.get_coords();
        let [r, x, y] = this.actor.transform_stage_point(stageX, stageY);

        for (let i = 0; i < this._thumbnails.length; i++) {
            let thumbnail = this._thumbnails[i];
            let [w, h] = thumbnail.actor.get_transformed_size();
            // add in the x criteria
            if (y >= thumbnail.actor.y && y <= thumbnail.actor.y + h &&
                    x >= thumbnail.actor.x && x <= thumbnail.actor.x + w) {
                thumbnail.activate(event.time);
                break;
            }
        }

        return true;
    },

    /* with drag and drop: modify to look at the x direction as well as the y */
    handleDragOver: function (source, actor, x, y, time) {
        if (!source.realWindow && !source.shellWorkspaceLaunch &&
                source !== Main.xdndHandler)
            return DND.DragMotionResult.CONTINUE;

        if (!Meta.prefs_get_dynamic_workspaces())
            return DND.DragMotionResult.CONTINUE;

        let targetBaseX,
            targetBaseY,
            spacing = this.actor.get_theme_node().get_length('spacing'),
            placeholderPos = -1,
            placeholderOrient = -1;

        this._dropWorkspace = -1;
        if (this._dropPlaceholderPos === 0) {
            targetBaseY = this._dropPlaceholder.y;
        } else {
            targetBaseY = this._thumbnails[0].actor.y;
        }
        let targetTop = targetBaseY - spacing - WORKSPACE_CUT_SIZE;
        let targetBottom, nextTargetBaseY, nextTargetTop, targetLeft;

        for (let i = 0; i < this._thumbnails.length; i++) {
            // Allow the reorder target to have a 10px "cut" into
            // each side of the thumbnail, to make dragging onto the
            // placeholder easier
            let [row, col] = indexToRowCol(i),
                [w, h] = this._thumbnails[i].actor.get_transformed_size();
            if (col === 0) { // new row.
                // 1) reset X targets to col 0
                if (this._dropPlaceholderPos === 0) {
                    targetBaseX = this._dropPlaceholder.x;
                } else {
                    targetBaseX = this._thumbnails[0].actor.x;
                }
                targetLeft = targetBaseX - spacing - WORKSPACE_CUT_SIZE;

                // 2) increment Y targets
                if (row > 0) {
                    targetBaseY = nextTargetBaseY;
                    targetTop = nextTargetTop; // THESE ARE GOING WRONG
                }
                targetBottom = targetBaseY + WORKSPACE_CUT_SIZE;
                nextTargetBaseY = targetBaseY + h + spacing;
                nextTargetTop = nextTargetBaseY - spacing -
                    ((row === global.screen.workspace_grid.rows - 1) ? 0 :
                         WORKSPACE_CUT_SIZE);
            }
            let targetRight = targetBaseX + WORKSPACE_CUT_SIZE,
                nextTargetBaseX = targetBaseX + w + spacing,
                nextTargetLeft =  nextTargetBaseX - spacing -
                    ((col === global.screen.workspace_grid.cols - 1) ? 0 :
                         WORKSPACE_CUT_SIZE);

            // Expand the target to include the placeholder, if it exists.
            if (i === this._dropPlaceholderPos) {
                // have to guard against the -1 case...
                if (this._dropPlaceholderHorizontal === true) {
                    targetBottom += this._dropPlaceholder.get_height();
                } else if (this._dropPlaceholderHorizontal === false) {
                    targetRight += this._dropPlaceholder.get_width();
                }
            }

            /*
            log('target area for workspace %d (%d, %d):\n  horizontal (%d, %d) to (%d, %d)\n  vertical (%d, %d) to (%d, %d)'.format(
                        i, row, col,
                        targetBaseX, targetTop, targetBaseX + w, targetBottom,
                        targetLeft, targetBaseY, targetRight, targetBaseY + h
                        ));
            */
            if (y > targetTop && y <= targetBottom &&
                    x >= targetBaseX && x <= (targetBaseX + w) &&
                    source !== Main.xdndHandler) {
                // workspace is placed
                placeholderPos = i;
                placeholderOrient = true;
                break;
            } else if (x > targetLeft && x <= targetRight &&
                    y >= targetBaseY && y <= (targetBaseY + h) &&
                    source !== Main.xdndHandler) {
                placeholderPos = i;
                placeholderOrient = false;
                break;
            } else if (y > targetBottom && y <= nextTargetTop &&
                    x > targetLeft && x <= nextTargetLeft) {
                this._dropWorkspace = i;
                break;
            }

            targetBaseX = nextTargetBaseX;
            targetLeft = nextTargetLeft;
        }

        if (this._dropPlaceholderPos !== placeholderPos ||
            (placeholderOrient !== -1 &&
                 this._dropPlaceholderHorizontal !== placeholderOrient)) {
            this._dropPlaceholderPos = placeholderPos;
            this._dropPlaceholderHorizontal = placeholderOrient;
            if (this._dropPlaceholderHorizontal &&
                    this._dropPlaceholder.has_style_class_name('placeholder-vertical')) {
                this._dropPlaceholder.style_class = 'placeholder';
            } else if (!this._dropPlaceholderHorizontal &&
                    this._dropPlaceholder.has_style_class_name('placeholder')) {
                this._dropPlaceholder.style_class = 'placeholder-vertical';
            }
            this.actor.queue_relayout();
        }

        if (this._dropWorkspace !== -1)
            return this._thumbnails[this._dropWorkspace].handleDragOverInternal(
                    source, time);
        else if (this._dropPlaceholderPos !== -1)
            return source.realWindow ? DND.DragMotionResult.MOVE_DROP :
                DND.DragMotionResult.COPY_DROP;
        else
            return DND.DragMotionResult.CONTINUE;
    },

    /* stuff to do with the indicator around the current workspace */
    set indicatorX(indicatorX) {
        this._indicatorX = indicatorX;
        //this.actor.queue_relayout(); // <-- we only ever change indicatorX
        // when we change indicatorY and that already causes a queue_relayout
        // so we omit it here so as not to have double the relayout requests..
    },

    get indicatorX() {
        return this._indicatorX;
    },

    _activeWorkspaceChanged: function () {
        let thumbnail;
        let activeWorkspace = global.screen.get_active_workspace();
        for (let i = 0; i < this._thumbnails.length; i++) {
            if (this._thumbnails[i].metaWorkspace === activeWorkspace) {
                thumbnail = this._thumbnails[i];
                break;
            }
        }

        this._animatingIndicator = true;
        this.indicatorY = this._indicator.allocation.y1;
        this.indicatorX = this._indicator.allocation.x1; // <-- added
        Tweener.addTween(this,
                         { indicatorY: thumbnail.actor.allocation.y1,
                           indicatorX: thumbnail.actor.allocation.x1, // added
                           time: WorkspacesView.WORKSPACE_SWITCH_TIME,
                           transition: 'easeOutQuad',
                           onComplete: function () {
                                this._animatingIndicator = false;
                                this._queueUpdateStates();
                            },
                           onCompleteScope: this
                         });
    },

    /**
     * The following are to get things to layout in a grid
     * Note: the mode is WIDTH_FOR_HEIGHT, and we make sure that the box is
     * no wider than MAX_SCREEN_HFRACTION fraction of the screen width wide.
     * If it is wider than MAX_SCREEN_HFRACTION_COLLAPSE then we initially
     * start the thumbnails box collapsed.
     **/
    _getPreferredHeight: function (actor, forWidth, alloc) {
        let themeNode = this._background.get_theme_node();
        forWidth = themeNode.adjust_for_width(forWidth);

        if (this._thumbnails.length === 0) {
            return;
        }

        let spacing = this.actor.get_theme_node().get_length('spacing'),
            nRows = global.screen.workspace_grid.rows,
            totalSpacing = (nRows - 1) * spacing,
            height = totalSpacing + nWorkspaces * this._porthole.height *
                MAX_THUMBNAIL_SCALE;

        [alloc.min_size, alloc.natural_size] =
            themeNode.adjust_preferred_height(height, height);

    },

    _getPreferredWidth: function (actor, forHeight, alloc) {
        if (this._thumbnails.length === 0) {
            return;
        }

        let themeNode = this._background.get_theme_node(),
            spacing = this.actor.get_theme_node().get_length('spacing'),
            nRows = global.screen.workspace_grid.rows,
            nCols = global.screen.workspace_grid.columns,
            totalSpacingX = (nCols - 1) * spacing,
            totalSpacingY = (nRows - 1) * spacing,
            availY = forHeight - totalSpacingY,
            //scale = (availY / nRows) / this._porthole.height;
            scale = (availY < 0 ? MAX_THUMBNAIL_SCALE :
                    (availY / nRows) / this._porthole.height);

        // 'scale' is the scale we need to fit `nRows` of workspaces in the
        // available height (after taking into account padding).
        scale = Math.min(scale, MAX_THUMBNAIL_SCALE);

        let width = totalSpacingX + nCols * this._porthole.width * scale,
            maxWidth = (Main.layoutManager.primaryMonitor.width *
                            settings.get_double(KEY_MAX_HFRACTION)) -
                       this.actor.get_theme_node().get_horizontal_padding() -
                       themeNode.get_horizontal_padding();

        width = Math.min(maxWidth, width);

        // If the thumbnails box is "too wide" (see
        //  MAX_SCREEN_HFRACTION_BEFORE_COLLAPSE), then we should always
        //  collapse the workspace thumbnails by default.
        _getWorkspaceDisplay()._alwaysZoomOut = (width <=
                (Main.layoutManager.primaryMonitor.width *
                 settings.get_double(KEY_MAX_HFRACTION_COLLAPSE)));

        // natural width is nCols of workspaces + (nCols-1)*spacingX
        [alloc.min_size, alloc.natural_size] =
            themeNode.adjust_preferred_width(width, width);
    },

    _allocate: function (actor, box, flags) {
        if (this._thumbnails.length === 0) // not visible
            return;

        let rtl = (Clutter.get_default_text_direction() ===
                Clutter.TextDirection.RTL),
        // See comment about this._background in _init()
            themeNode = this._background.get_theme_node(),
            contentBox = themeNode.get_content_box(box),
            portholeWidth = this._porthole.width,
            portholeHeight = this._porthole.height,
            spacing = this.actor.get_theme_node().get_length('spacing'),
        // Compute the scale we'll need once everything is updated
            nCols = global.screen.workspace_grid.columns,
            nRows = global.screen.workspace_grid.rows,
            totalSpacingY = (nRows - 1) * spacing,
            totalSpacingX = (nCols - 1) * spacing,
            availX = (contentBox.x2 - contentBox.x1) - totalSpacingX,
            availY = (contentBox.y2 - contentBox.y1) - totalSpacingY;

        // work out what scale we need to squeeze all the rows/cols of
        // workspaces in
        let newScale = Math.min((availX / nCols) / portholeWidth,
                            (availY / nRows) / portholeHeight,
                            MAX_THUMBNAIL_SCALE);

        if (newScale !== this._targetScale) {
            if (this._targetScale > 0) {
                // We don't do the tween immediately because we need to observe
                // the ordering in queueUpdateStates - if workspaces have been
                // removed we need to slide them out as the first thing.
                this._targetScale = newScale;
                this._pendingScaleUpdate = true;
            } else {
                this._targetScale = this._scale = newScale;
            }

            this._queueUpdateStates();
        }

        let thumbnailHeight = portholeHeight * this._scale,
            thumbnailWidth = portholeWidth * this._scale,
            roundedHScale = Math.round(thumbnailWidth) / portholeWidth,
            roundedVScale = Math.round(thumbnailHeight) / portholeHeight;

        let slideOffset; // X offset when thumbnail is fully slid offscreen
        // (animate sliding that column onto screen)
        if (rtl)
            slideOffset = -thumbnailWidth + themeNode.get_padding(St.Side.LEFT);
        else
            slideOffset = thumbnailWidth + themeNode.get_padding(St.Side.RIGHT);

        let childBox = new Clutter.ActorBox();

        // Don't understand workspaceThumbnail.js here - I just cover the
        // entire allocation?
        this._background.allocate(box, flags);
        // old: box.x1 = box.x1 + (contentBox.x2-contentBox.x1) - thumbnailWid

        let indicatorY = this._indicatorY,
            indicatorX = this._indicatorX;
        // when not animating, the workspace position overrides this._indicatorY
        let indicatorWorkspace = !this._animatingIndicator ?
            global.screen.get_active_workspace() : null;

        // position roughly centred vertically: start at y1 + (backgroundHeight
        //  - thumbnailsHeights)/2
        let y = contentBox.y1 + (availY - (nRows * thumbnailHeight)) / 2,
            x = contentBox.x1,
            i = 0,
            thumbnail;

        if (this._dropPlaceholderPos === -1) {
            Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this,
                function () {
                    this._dropPlaceholder.hide();
                }));
        }

        for (let row = 0; row < global.screen.workspace_grid.rows; ++row) {
            x = contentBox.x1;
            for (let col = 0; col < global.screen.workspace_grid.columns; ++col) {
                thumbnail = this._thumbnails[i];

                // NOTE: original ThumbnailsBox does a lot of intricate calcul-
                // ations to do with rounding to make sure everything's evenly
                // spaced; we don't bother because I'm not smart enough to work
                // it out (so the spacing on the left might be a few pixels
                // more than that on the right).
                let x1 = x,
                    y1 = y;

                if (thumbnail.slidePosition !== 0) {
                    if (rtl) {
                        x1 -= slideOffset * thumbnail.slidePosition;
                    } else {
                        x1 += slideOffset * thumbnail.slidePosition;
                    }
                }

                if (i === this._dropPlaceholderPos) {
                    if (this._dropPlaceholderHorizontal) {
                        let [minHeight, placeholderHeight] =
                            this._dropPlaceholder.get_preferred_height(-1);
                        childBox.x1 = x1;
                        childBox.x2 = x1 + thumbnailWidth;
                        childBox.y1 = y;
                        childBox.y2 = y + placeholderHeight;

                        y1 += placeholderHeight + spacing;
                    } else {
                        let [minWidth, placeholderWidth] =
                            this._dropPlaceholder.get_preferred_width(-1);
                        childBox.x1 = x1;
                        childBox.x2 = x1 + placeholderWidth;
                        childBox.y1 = y;
                        childBox.y2 = y + thumbnailHeight;

                        x += placeholderWidth + spacing;
                        x1 += placeholderWidth + spacing;
                    }
                    this._dropPlaceholder.allocate(childBox, flags);
                    Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this,
                        function () {
                            this._dropPlaceholder.show();
                        }));
                }

                if (thumbnail.metaWorkspace === indicatorWorkspace) {
                    indicatorY = y1;
                    indicatorX = x1;
                }

                // Allocating a scaled actor is funny - x1/y1 correspond to the
                // origin of the actor, but x2/y2 are increased by the unscaled
                // size.
                childBox.x1 = x1;
                childBox.x2 = x1 + portholeWidth;
                childBox.y1 = y1;
                childBox.y2 = y1 + portholeHeight;

                thumbnail.actor.set_scale(roundedHScale, roundedVScale);
                thumbnail.actor.allocate(childBox, flags);

                x += thumbnailWidth - thumbnailWidth *
                    thumbnail.collapseFraction;

                // add spacing
                x += spacing - thumbnail.collapseFraction * spacing;

                ++i;
                if (i >= MAX_WORKSPACES) {
                    break;
                }
            }
            y += thumbnailHeight - thumbnailHeight * thumbnail.collapseFraction;
            // add spacing
            y += spacing - thumbnail.collapseFraction * spacing;

            if (i >= MAX_WORKSPACES) {
                break;
            }
        }

        // allocate the indicator (which tells us what is the current workspace)
        childBox.x1 = indicatorX;
        childBox.x2 = indicatorX + thumbnailWidth;
        childBox.y1 = indicatorY;
        childBox.y2 = indicatorY + thumbnailHeight;
        this._indicator.allocate(childBox, flags);
    },

    destroy: function () {
        this.actor.destroy();
        let i = this._signals.length;
        while (i--) {
            Main.overview.disconnect(this._signals[i]);
        }
        this._signals = [];
    }
});

/* Get the thumbnails box to acknowledge a change in allowable width */
function refreshThumbnailsBox() {
    if (Main.overview.visible) {
        // we hope that when they close the overview and reopen it, that will
        // do the trick.
        // (they can't really use the prefs widget while in the overview anyway)
        return;
    }
    // get the thumbnailsbox to re-allocate itself
    // (TODO: for some reason the *first* overview show won't respect this but
    // subsequent ones will).
    let wD = _getWorkspaceDisplay();
    wD._thumbnailsBox.actor.queue_relayout();
}

/**
 * We need to:
 * 1) override the scroll event on workspaces display to allow sideways
 *    scrolling too
 * 2) replace the old thumbnailsBox with our own (because you can't
 *    override ._getPreferredHeight etc that are passed in as *callbacks*).
 */
function overrideWorkspaceDisplay() {
    // 1) override scroll event. Note we can't just overwrite
    // .prototype._onScrollEvent because somehow by then the old _onScrollEvent
    // is already bound to the 'scroll-event' signal.
    // We'll have to destroy controls and re-create it (because it doesn't even
    // have .disconnectAll()!)
    // The following mirrors _init in WorkspacesDisplay.
    let wD = _getWorkspaceDisplay();
    let controls = wD._controls = new St.Bin({
        style_class: 'workspace-controls',
        request_mode: Clutter.RequestMode.WIDTH_FOR_HEIGHT,
        y_align: St.Align.START,
        y_fill: true
    });
    wD.actor.add_actor(controls);
    controls.reactive = true;
    controls.track_hover = true;
    controls.connect('notify::hover', Lang.bind(wD, wD._onControlsHoverChanged));
    onScrollId = controls.connect('scroll-event',
        Lang.bind(wD, function (actor, event) {
            switch (event.get_scroll_direction()) {
            case Clutter.ScrollDirection.UP:
                moveWorkspace(UP, settings.get_boolean(KEY_WRAPAROUND));
                break;
            case Clutter.ScrollDirection.DOWN:
                moveWorkspace(DOWN, settings.get_boolean(KEY_WRAPAROUND));
                break;
            case Clutter.ScrollDirection.LEFT:
                moveWorkspace(LEFT, settings.get_boolean(KEY_WRAPAROUND));
                break;
            case Clutter.ScrollDirection.RIGHT:
                moveWorkspace(RIGHT, settings.get_boolean(KEY_WRAPAROUND));
                break;
            }
        }));

    // 2. Replace workspacesDisplay._thumbnailsBox with my own.
    // Start with controls collapsed (since the workspace thumbnails can take
    // up quite a bit of space horizontally). This will be recalculated
    // every time the overview shows.
    wD._thumbnailsBox.actor.unparent();
    thumbnailsBox = wD._thumbnailsBox = new ThumbnailsBox();
    controls.add_actor(thumbnailsBox.actor);
    wD._alwaysZoomOut = false;

    refreshThumbnailsBox();
}

function unoverrideWorkspaceDisplay() {
    let wD = _getWorkspaceDisplay();
    // put the original _scrollEvent back again
    if (onScrollId) {
        wD._controls.disconnect(onScrollId);
        onScrollId = 0;
    }
    wD._controls.connect('scroll-event', Lang.bind(wD, wD._onScrollEvent));

    // replace the ThumbnailsBox with the original one
    thumbnailsBox.destroy();
    thumbnailsBox = null;
    let box = wD._thumbnailsBox = new WorkspaceThumbnail.ThumbnailsBox();
    wD._controls.add_actor(box.actor);
    wD._updateAlwaysZoom(); // undo our zoom changes.
}

/******************
 * tells Meta about the number of workspaces we want
 ******************/
function modifyNumWorkspaces() {
    /// Setting the number of workspaces.
    Meta.prefs_set_num_workspaces(
        global.screen.workspace_grid.rows * global.screen.workspace_grid.columns
    );

    /* NOTE: in GNOME 3.4, Meta.prefs_set_num_workspaces has *no effect*
     * if Meta.prefs_get_dynamic_workspaces is true.
     * (see mutter/src/core/screen.c prefs_changed_callback).
     * To *actually* increase/decrease the number of workspaces (to fire
     * notify::n-workspaces), we must use global.screen.append_new_workspace and
     * global.screen.remove_workspace.
     *   
     * We could just set org.gnome.shell.overrides.dynamic-workspaces to false
     * but then we can't drag and drop windows between workspaces (supposedly a
     * GNOME 3.4 bug, see the Frippery Static Workspaces extension. Can confirm
     * but cannot find a relevant bug report/fix.)
     */
    // Hmm - in 3.6 this is the only way I can get it working without dynamic
    // workspaces too.
    let newtotal = (global.screen.workspace_grid.rows *
        global.screen.workspace_grid.columns);
    if (global.screen.n_workspaces < newtotal) {
        for (let i = global.screen.n_workspaces; i < newtotal; ++i) {
            global.screen.append_new_workspace(false,
                    global.get_current_time());
        }
    } else if (global.screen.n_workspaces > newtotal) {
        for (let i = global.screen.n_workspaces - 1; i >= newtotal; --i) {
            global.screen.remove_workspace(
                    global.screen.get_workspace_by_index(i),
                    global.get_current_time()
            );
        }
    }

    // This appears to do nothing but we'll do it in case it helps.
    global.screen.override_workspace_layout(
        Meta.ScreenCorner.TOPLEFT, // workspace 0
        false, // true == lay out in columns. false == lay out in rows
        global.screen.workspace_grid.rows,
        global.screen.workspace_grid.columns
    );

    // this forces the workspaces display to update itself to match the new
    // number of workspaces.
    global.screen.notify('n-workspaces');
}

function unmodifyNumWorkspaces() {
    // restore original number of workspaces
    Meta.prefs_set_num_workspaces(nWorkspaces);

    global.screen.override_workspace_layout(
        Meta.ScreenCorner.TOPLEFT, // workspace 0
        true, // true == lay out in columns. false == lay out in rows
        nWorkspaces,
        1 // columns
    );
}

/******************
 * This is the stuff from Frippery Static Workspaces
 ******************/
function dummy() {
    return false;
}

function makeWorkspacesStatic() {
    /// storage
    staticWorkspaceStorage._nWorkspacesChanged = Main._nWorkspacesChanged;
    staticWorkspaceStorage._queueCheckWorkspaces = Main._queueCheckWorkspaces;
    staticWorkspaceStorage._checkWorkspaces = Main._checkWorkspaces;

    /// patching
    Main._nWorkspacesChanged = dummy;
    Main._queueCheckWorkspaces = dummy;
    Main._checkWorkspaces = dummy;

    Main._workspaces.forEach(function (workspace) {
            workspace.disconnect(workspace._windowAddedId);
            workspace.disconnect(workspace._windowRemovedId);
            workspace._lastRemovedWindow = null;
        });
}

function unmakeWorkspacesStatic() {
    // undo make workspaces static
    Main._nWorkspacesChanged = staticWorkspaceStorage._nWorkspacesChanged;
    Main._queueCheckWorkspaces = staticWorkspaceStorage._queueCheckWorkspaces;
    Main._checkWorkspaces = staticWorkspaceStorage._checkWorkspaces;

    Main._workspaces = [];

    // recalculate new number of workspaces.
    Main._nWorkspacesChanged();
}

/******************
 * Store rows/cols of workspaces, convenience functions to
 * global.screen.workspace_grid
 * such that if other extension authors want to they can use them.
 *
 * Exported constants:
 * Directions = { UP, LEFT, RIGHT, DOWN } : directions for navigating workspaces
 * rows     : number of rows of workspaces
 * columns  : number of columns of workspaces
 *
 * Exported functions:
 * rowColToIndex : converts the row/column into an index for use with (e.g.)
 *                 global.screen.get_workspace_by_index(i)
 * indexToRowCol : converts an index (0 to global.screen.n_workspaces-1) to a
 *                 row and column
 * moveWorkspace : switches workspaces in the direction specified, being either
 *                 UP, LEFT, RIGHT or DOWN (see Directions).
 ******************/
function exportFunctionsAndConstants() {
    global.screen.workspace_grid = {
        Directions: {
            UP: UP,
            LEFT: LEFT,
            RIGHT: RIGHT,
            DOWN: DOWN
        },

        rows: settings.get_int(KEY_ROWS),
        columns: settings.get_int(KEY_COLS),

        rowColToIndex: rowColToIndex,
        indexToRowCol: indexToRowCol,
        getWorkspaceSwitcherPopup: getWorkspaceSwitcherPopup,
        calculateWorkspace: calculateWorkspace,
        moveWorkspace: moveWorkspace
    };

    // It seems you can only have 36 workspaces max.
    if (settings.get_int(KEY_ROWS) * settings.get_int(KEY_COLS) >
            MAX_WORKSPACES) {
        log("WARNING [workspace-grid]: You can have at most 36 workspaces, " +
                "will ignore the rest");
        global.screen.workspace_grid.rows = Math.ceil(
                MAX_WORKSPACES / global.screen.workspace_grid.columns);
    }
}

function unexportFunctionsAndConstants() {
    delete global.screen.workspace_grid;
}

/***************************
 *         EXTENSION       *
 ***************************/

function init() {
}

let signals = [];
function enable() {
    /// Storage
    nWorkspaces = Meta.prefs_get_num_workspaces();

    settings = Convenience.getSettings();
    makeWorkspacesStatic();
    exportFunctionsAndConstants(); // so other extension authors can use.
    overrideKeybindingsAndPopup();
    overrideWorkspaceDisplay();
    // Main.start() gets in one call to _nWorkspacesChanged that appears to
    // be queued before any extensions enabled (so my subsequent patching
    // doesn't do anything), but takes affect *after* my `modifyNumWorkspaces`
    // call, killing all the extra workspaces I just added...
    // So we wait a little bit before caling.
    //modifyNumWorkspaces();
    Mainloop.idle_add(modifyNumWorkspaces);

    // Connect settings change: the only one we have to monitor is cols/rows
    signals.push(settings.connect('changed::' + KEY_ROWS, nWorkspacesChanged));
    signals.push(settings.connect('changed::' + KEY_COLS, nWorkspacesChanged));
    signals.push(settings.connect('changed::' + KEY_MAX_HFRACTION, refreshThumbnailsBox));
    signals.push(settings.connect('changed::' + KEY_MAX_HFRACTION_COLLAPSE, refreshThumbnailsBox));
}

function nWorkspacesChanged() {
    // re-export new rows/cols
    exportFunctionsAndConstants();
    // reset the number of workspaces
    modifyNumWorkspaces();
}

function disable() {
    unoverrideWorkspaceDisplay();
    unoverrideKeybindingsAndPopup();
    unmodifyNumWorkspaces();
    unexportFunctionsAndConstants();
    unmakeWorkspacesStatic();

    let i = signals.length;
    while (i--) {
        settings.disconnect(signals.pop());
    }

    // just in case, let everything else get used to the new number of
    // workspaces.
    global.screen.notify('n-workspaces');
}

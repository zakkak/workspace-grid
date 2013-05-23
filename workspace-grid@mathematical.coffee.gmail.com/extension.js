/*global global, log */ // <-- jshint
/*jshint unused: true */
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
 */

//// CONFIGURE HERE (note: you can have at most 36 workspaces)
const WORKSPACE_CONFIGURATION = {
    rows: 2,
    columns: 3
};

// when navigating workspaces do you want to wrap around from the start to the
// end?
const WRAPAROUND = true;
// *IF* the above is 'true', when we wrap around, do you wish to wrap to/from
// the *same* row/column, or to the next one?
// E.g. if we had 2 rows and 2 columns and we tried to move to the workspace
//      right of the top-right corner (row 1 column 2)  and WRAPAROUND set to true:
// * with WRAP_TO_SAME as `true`, we wrap to row 1 column 1 (i.e. wrap around,
//   but to the same row)
// * with WRAP_TO_SAME as `false`, w wrap to row *2* column 1 (i.e. wrap around,
//   but to the *next* row).
const WRAP_TO_SAME = false;

// In the overview the workspace thumbnail sidebar can get pretty wide if you
// have multiple columns of workspaces.
// The thumbnail sidebar is constrained to be *at most* this wide (fraction of
// the screen width)
const MAX_SCREEN_HFRACTION = 0.8;
// When the thumbnail sidebar becomes wider than this, it will be collapsed by
// default (so you can hover your mouse over it to expand it).
// Must be <= MAX_SCREEN_HFRACTION.
const MAX_SCREEN_HFRACTION_BEFORE_COLLAPSE = 0.3;

// show the labels of the workspaces on the switcher?
const SHOW_WORKSPACE_LABELS = true;

////////// CODE ///////////
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const WindowManager = imports.ui.windowManager;
const WorkspaceSwitcher = imports.ui.workspaceSwitcherPopup;
const WorkspaceThumbnail = imports.ui.workspaceThumbnail;
const WorkspacesView = imports.ui.workspacesView;

/* These double as keybinding names and ways for moveWorkspace to know which
 * direction I want to switch to */
const UP = 'switch_to_workspace_up';
const DOWN = 'switch_to_workspace_down';
const LEFT = 'switch_to_workspace_left';
const RIGHT = 'switch_to_workspace_right';

/* it seems the max number of workspaces is 36
 * (MAX_REASONABLE_WORKSPACES in mutter/src/core/prefs.c)
 */
const MAX_WORKSPACES = 36;

/* Import some constants from other files and also some laziness */
const MAX_THUMBNAIL_SCALE = WorkspaceThumbnail.MAX_THUMBNAIL_SCALE;
const WORKSPACE_CUT_SIZE = WorkspaceThumbnail.WORKSPACE_CUT_SIZE;
const ThumbnailsBoxProto = WorkspaceThumbnail.ThumbnailsBox.prototype;
const WMProto = WindowManager.WindowManager.prototype;

/* storage for the extension */
let staticWorkspaceStorage = {};
let wmStorage = {};
let nWorkspaces;
let workspaceSwitcherPopup = null;
let globalKeyPressHandler = null;
let thumbnailsBox = null;
let onScrollId = 0;

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

/* Switch to the appropriate workspace.
 * direction is either UP, LEFT, RIGHT or DOWN.
 *
 * This can occur through:
 * - keybinding (wm.setKeybindingHandler)
 * - keybinding with global grab in progress (e.g. Overview/lg)
 * - scrolling/clicking in the overview
 * - (other extensions, e.g. navigate with up/down arrows:
 *        https://extensions.gnome.org/extension/29/workspace-navigator/)
 */
function moveWorkspace(direction, wraparound, wrapToSame) {
    let from = global.screen.get_active_workspace_index(),
        [row, col] = indexToRowCol(from),
        to;

    switch (direction) {
    case LEFT:
        if (col === 0) {
            if (wraparound) {
                col = global.screen.workspace_grid.columns - 1;
                if (!wrapToSame) row--;
            }
        } else {
            col--;
        }
        break;
    case RIGHT:
        if (col === global.screen.workspace_grid.columns - 1) {
            if (wraparound) {
                col = 0;
                if (!wrapToSame) row++;
            }
        } else {
            col++;
        }
        break;
    case UP:
        if (row === 0) {
            if (wraparound) {
                row = global.screen.workspace_grid.rows - 1;
                if (!wrapToSame) col--;
            }
        } else {
            row--;
        }
        break;
    case DOWN:
        if (row === global.screen.workspace_grid.rows - 1) {
            if (wraparound) {
                row = 0;
                if (!wrapToSame) col++;
            }
        } else {
            row++;
        }
        break;
    }
    if (col < 0 || row < 0) {
        to = global.screen.n_workspaces - 1;
    } else if (col > global.screen.workspace_grid.columns - 1 ||
               row > global.screen.workspace_grid.rows - 1) {
        to = 0;
    } else {
        to = rowColToIndex(row, col);
    }

    // log('moving from workspace %d to %d'.format(from, to));
    if (to !== from) {
        global.screen.get_workspace_by_index(to).activate(
                global.get_current_time());
    }

    if (!workspaceSwitcherPopup) {
        workspaceSwitcherPopup = new WorkspaceSwitcherPopup();
    }

    // show the workspace switcher popup
    if (!Main.overview.visible) {
        workspaceSwitcherPopup.display(direction, to);
    }
}

/************
 * Workspace Switcher that can do rows and columns as opposed to just rows.
 ************/
function WorkspaceSwitcherPopup() {
    this._init(this);
}

WorkspaceSwitcherPopup.prototype = {
    __proto__: WorkspaceSwitcher.WorkspaceSwitcherPopup.prototype,

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

    _redraw: function (direction, activeWorkspaceIndex) {
        this._list.destroy_children();

        for (let i = 0; i < global.screen.n_workspaces; ++i) {
            let indicator = null;
            let name = Meta.prefs_get_workspace_name(i);

            if (i === activeWorkspaceIndex && direction === UP) {
                indicator = new St.Bin({
                    style_class: 'ws-switcher-active-up'
                });
            } else if (i === activeWorkspaceIndex && direction === DOWN) {
                indicator = new St.Bin({
                    style_class: 'ws-switcher-active-down'
                });
            } else if (i === activeWorkspaceIndex && direction === LEFT) {
                indicator = new St.Bin({
                    style_class: 'ws-switcher-active-left'
                });
            } else if (i === activeWorkspaceIndex && direction === RIGHT) {
                indicator = new St.Bin({
                    style_class: 'ws-switcher-active-right'
                });
            } else {
                indicator = new St.Bin({style_class: 'ws-switcher-box'});
            }
            if (SHOW_WORKSPACE_LABELS && i !== activeWorkspaceIndex) {
                indicator.child = new St.Label({
                    text: name,
                    style_class: 'ws-switcher-label'
                });
            }

            this._list.add_actor(indicator);
        }
    }
};

/* Keybinding handler.
 * Should bring up a workspace switcher.
 */
function showWorkspaceSwitcher(shellwm, binding, mask, window, backwards) {
    if (global.screen.n_workspaces === 1)
        return;

    moveWorkspace(binding, WRAPAROUND, WRAP_TO_SAME);
}

/******************
 * Overrides the 'switch_to_workspace_XXX' keybindings
 ******************/
function overrideKeybindingsAndPopup() {
    Main.wm.setKeybindingHandler(LEFT, showWorkspaceSwitcher);
    Main.wm.setKeybindingHandler(RIGHT, showWorkspaceSwitcher);
    Main.wm.setKeybindingHandler(UP, showWorkspaceSwitcher);
    Main.wm.setKeybindingHandler(DOWN, showWorkspaceSwitcher);

    // make sure our keybindings work when (e.g.) overview is open too.
    globalKeyPressHandler = Main._globalKeyPressHandler;
    Main._globalKeyPressHandler = function (actor, event) {
        /* First let our WORKSPACE_<direction> keybinding handlers override
         * any in _globalKeyPressHandler, then proceed to _globalKeyPressHandler
         */
        if (Main.modalCount === 0 ||
                event.type() !== Clutter.EventType.KEY_PRESS) {
            return false;
        }

        if (global.session_type === Shell.SessionType.USER &&
                (!Main.overview.visible || Main.modalCount > 1)) {
            return false;
        }

        let keyCode = event.get_key_code(),
            modifierState = Shell.get_event_state(event),
            action = global.display.get_keybinding_action(keyCode,
                    modifierState);

        switch (action) {
        case Meta.KeyBindingAction.WORKSPACE_LEFT:
            moveWorkspace(LEFT, WRAPAROUND, WRAP_TO_SAME);
            return true;
        case Meta.KeyBindingAction.WORKSPACE_RIGHT:
            moveWorkspace(RIGHT, WRAPAROUND, WRAP_TO_SAME);
            return true;
        case Meta.KeyBindingAction.WORKSPACE_UP:
            moveWorkspace(UP, WRAPAROUND, WRAP_TO_SAME);
            return true;
        case Meta.KeyBindingAction.WORKSPACE_DOWN:
            moveWorkspace(DOWN, WRAPAROUND, WRAP_TO_SAME);
            return true;
        }
        return globalKeyPressHandler(actor, event);
    };

    // Override imports.ui.windowManager.actionMoveWorkspace* just in case other
    // extensions use them.
    wmStorage.actionMoveWorkspaceUp = WMProto.actionMoveWorkspaceUp;
    WMProto.actionMoveWorkspaceUp = function () {
        moveWorkspace(UP, WRAPAROUND, WRAP_TO_SAME);
    };
    wmStorage.actionMoveWorkspaceDown = WMProto.actionMoveWorkspaceDown;
    WMProto.actionMoveWorkspaceDown = function () {
        moveWorkspace(DOWN, WRAPAROUND, WRAP_TO_SAME);
    };
    wmStorage.actionMoveWorkspaceLeft = WMProto.actionMoveWorkspaceLeft;
    WMProto.actionMoveWorkspaceLeft = function () {
        moveWorkspace(LEFT, WRAPAROUND, WRAP_TO_SAME);
    };
    wmStorage.actionMoveWorkspaceRight = WMProto.actionMoveWorkspaceRight;
    WMProto.actionMoveWorkspaceRight = function () {
        moveWorkspace(RIGHT, WRAPAROUND, WRAP_TO_SAME);
    };
}

/* Restore the original keybindings */
function unoverrideKeybindingsAndPopup() {
    // Restore the original keybindings.
    Main.wm.setKeybindingHandler(LEFT, Lang.bind(Main.wm,
                Main.wm._showWorkspaceSwitcher));
    Main.wm.setKeybindingHandler(RIGHT, Lang.bind(Main.wm,
                Main.wm._showWorkspaceSwitcher));
    Main.wm.setKeybindingHandler(UP, Lang.bind(Main.wm,
                Main.wm._showWorkspaceSwitcher));
    Main.wm.setKeybindingHandler(DOWN, Lang.bind(Main.wm,
                Main.wm._showWorkspaceSwitcher));

    Main._globalKeyPressHandler = globalKeyPressHandler;

    workspaceSwitcherPopup = null;

    WMProto.actionMoveWorkspaceUp = wmStorage.actionMoveWorkspaceUp;
    WMProto.actionMoveWorkspaceDown = wmStorage.actionMoveWorkspaceDown;
    WMProto.actionMoveWorkspaceLeft = wmStorage.actionMoveWorkspaceLeft;
    WMProto.actionMoveWorkspaceRight = wmStorage.actionMoveWorkspaceRight;
}

/******************
 * Overrides the workspaces display in the overview
 ******************/
function ThumbnailsBox() {
    this._init();
}
ThumbnailsBox.prototype = {
    // NOTES ON SIZING
    // ---------------
    // We can use up to the entire height of the screen for vertical positioning
    // We can use up to (???) fraction of the width for horizontal positioning
    // Pick the scale that makes it fit.
    __proto__: ThumbnailsBoxProto,

    /**
     * The following are overridden simply to incorporate ._indicatorX in the
     * same way as ._indicatorY
     **/
    _init: function () {
        ThumbnailsBoxProto._init.apply(this);
        this._indicatorX = 0; // to match indicatorY
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

    _activeWorkspaceChanged: function (wm, from, to, direction) {
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
                            MAX_SCREEN_HFRACTION) -
                       this.actor.get_theme_node().get_horizontal_padding() -
                       themeNode.get_horizontal_padding();

        width = Math.min(maxWidth, width);

        // If the thumbnails box is "too wide" (see
        //  MAX_SCREEN_HFRACTION_BEFORE_COLLAPSE), then we should always
        //  collapse the workspace thumbnails by default.
        Main.overview._workspacesDisplay._alwaysZoomOut = (width <=
                (Main.layoutManager.primaryMonitor.width *
                 MAX_SCREEN_HFRACTION_BEFORE_COLLAPSE));

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
            thumbnailsWidth = nCols * thumbnailWidth + totalSpacingX;

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
            x = rtl ? contentBox.x1 : contentBox.x2 - thumbnailsWidth,
            i = 0;

        // Note: will ignore all collapseFraction/slidePosition stuff as since
        // workspaces are static, there is no concept of removing/adding
        // workspaces (a workspace slides out before collapsing when destroyed).
        for (let row = 0; row < nRows; ++row) {
            let y1 = Math.round(y),
               roundedVScale = (Math.round(y + thumbnailHeight) - y1) / portholeHeight;
            // reset x.
            x = rtl ? contentBox.x1 : contentBox.x2 - thumbnailsWidth;
            for (let col = 0; col < nCols; ++col) {
                let thumbnail = this._thumbnails[i],
                    x1 = Math.round(x),
                    roundedHScale = (Math.round(x + thumbnailWidth) - x1) / portholeWidth;

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

                x += thumbnailWidth + spacing;
                ++i;
                if (i >= MAX_WORKSPACES) {
                    break;
                }
            }
            y += thumbnailHeight + spacing;
            // add spacing
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
    }
};

/* Get the thumbnails box to acknowledge a change in allowable width */
function refreshThumbnailsBox() {
    // this is the only way I can find to get the thumbnailsbox to
    // re-allocate itself
    Main.overview._workspacesDisplay.show();
    Main.overview._workspacesDisplay.hide();
}

/**
 * We need to:
 * 1) override the scroll event on workspaces display to allow sideways
 *    scrolling too
 * 2) replace the old thumbnailsBox with our own (because you can't
 *    override ._getPreferredHeight etc that are passed in as *callbacks*).
 */
function overrideWorkspaceDisplay() {
    // 1) override scroll event. Due to us taking control of
    //  actionMoveWorkspace(Up|Down) we don't have to modify wD._onScrollEvent
    //  ourselves; instead, we just add another listener and deal with
    //  left/right directions.
    let wD = Main.overview._workspacesDisplay,
        controls = wD._controls;

    onScrollId = controls.connect('scroll-event',
        Lang.bind(wD, function (actor, event) {
            if (!this.actor.mapped)
                return false;
            switch ( event.get_scroll_direction() ) {
            case Clutter.ScrollDirection.LEFT:
                Main.wm.actionMoveWorkspaceLeft();
                return true;
            case Clutter.ScrollDirection.RIGHT:
                Main.wm.actionMoveWorkspaceRight();
                return true;
            }
            return false;
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
    let wD = Main.overview._workspacesDisplay;
    // put the original _scrollEvent back again
    if (onScrollId) {
        wD._controls.disconnect(onScrollId);
        onScrollId = 0;
    }

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

    // This appears to do nothing but we'll do it in case it helps.
    global.screen.override_workspace_layout(
        Meta.ScreenCorner.TOPLEFT, // workspace 0
        false, // true == lay out in columns. false == lay out in rows
        global.screen.workspace_grid.rows,
        global.screen.workspace_grid.columns
    );

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

        rows: WORKSPACE_CONFIGURATION.rows,
        columns: WORKSPACE_CONFIGURATION.columns,

        rowColToIndex: rowColToIndex,
        indexToRowCol: indexToRowCol,
        moveWorkspace: moveWorkspace
    };

    // It seems you can only have 36 workspaces max.
    if (WORKSPACE_CONFIGURATION.rows * WORKSPACE_CONFIGURATION.columns >
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

function enable() {
    /// Storage
    nWorkspaces = Meta.prefs_get_num_workspaces();

    makeWorkspacesStatic();
    exportFunctionsAndConstants(); // so other extension authors can use.
    modifyNumWorkspaces();
    overrideKeybindingsAndPopup();
    overrideWorkspaceDisplay();

    // this forces the workspaces display to update itself to match the new
    // number of workspaces.
    global.screen.notify('n-workspaces');
}

function disable() {
    unoverrideWorkspaceDisplay();
    unoverrideKeybindingsAndPopup();
    unmodifyNumWorkspaces();
    unexportFunctionsAndConstants();
    unmakeWorkspacesStatic();

    // just in case, let everything else get used to the new number of
    // workspaces.
    global.screen.notify('n-workspaces');
}

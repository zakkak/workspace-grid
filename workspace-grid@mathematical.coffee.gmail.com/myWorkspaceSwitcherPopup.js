/***********************************************************************
 * Copyright (C) 2015, 2018 Foivos S. Zakkak <foivos@zakkak.net>       *
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

const Lang     = imports.lang;
const Main     = imports.ui.main;
const Meta     = imports.gi.Meta;
const St       = imports.gi.St;
const Clutter  = imports.gi.Clutter;
const Mainloop = imports.mainloop;
const Tweener = imports.ui.tweener;
const GLib = imports.gi.GLib;

const ExtensionUtils = imports.misc.extensionUtils;
const Me             = ExtensionUtils.getCurrentExtension();
const Prefs          = Me.imports.prefs;

const WorkspaceSwitcherPopup = imports.ui.workspaceSwitcherPopup;

const UP    = Meta.MotionDirection.UP;
const DOWN  = Meta.MotionDirection.DOWN;
const LEFT  = Meta.MotionDirection.LEFT;
const RIGHT = Meta.MotionDirection.RIGHT;

var ANIMATION_TIME = WorkspaceSwitcherPopup.ANIMATION_TIME;

/************
 * Workspace Switcher that can do rows and columns as opposed to just rows.
 ************/
const myWorkspaceSwitcherPopup = new Lang.Class({
    Name: 'myWorkspaceSwitcherPopup',
    Extends: WorkspaceSwitcherPopup.WorkspaceSwitcherPopup,

    _init : function (settings) {
        this._settings = settings;

        if (this._settings.get_boolean(Prefs.KEY_SHOW_WORKSPACE_THUMBNAILS)) {
            this._thumbnailsBox = new Me.imports.extension.ThumbnailsBox();
            this._thumbnailsBox._createThumbnails();
            this._thumbnailsBox.actor.style_class = 'workspace-switcher-thumbnails';
        }

        this.parent();

        if (this._settings.get_boolean(Prefs.KEY_SHOW_WORKSPACE_THUMBNAILS)) {
            this.actor.add_actor(this._thumbnailsBox.actor);
            this._container.hide();
        }
    },

    // note: this makes sure everything fits vertically and then adjust the
    // horizontal to fit.
    _getPreferredHeight : function (actor, forWidth, alloc) {
        let children    = this._list.get_children(),
            primary     = Main.layoutManager.primaryMonitor,
            nrows       = global.screen.workspace_grid.rows,
            availHeight = primary.height,
            height      = 0,
            spacing     = this._itemSpacing * (nrows - 1);

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

        alloc.min_size     = height;
        alloc.natural_size = height;
    },

    _getPreferredWidth : function (actor, forHeight, alloc) {
        let primary = Main.layoutManager.primaryMonitor,
            ncols   = global.screen.workspace_grid.columns;
        this._childWidth = this._childHeight * primary.width / primary.height;
        let width   = this._childWidth * ncols + this._itemSpacing * (ncols - 1),
            padding = this.actor.get_theme_node().get_horizontal_padding() +
                      this._list.get_theme_node().get_horizontal_padding() +
                      this._container.get_theme_node().get_horizontal_padding();

        // but constrain to at most primary.width
        if (width + padding > primary.width) {
            this._childWidth  = (primary.width - padding -
                                this._itemSpacing * (ncols - 1)) / ncols;
            this._childHeight = this._childWidth * primary.height /
                                primary.width;
            width = primary.width - padding;
        }

        alloc.min_size     = width;
        alloc.natural_size = width;
    },

    _allocate : function (actor, box, flags) {
        let children = this._list.get_children(),
            childBox = new Clutter.ActorBox(),
            x        = box.x1,
            y        = box.y1,
            prevX    = x,
            prevY    = y,
            i        = 0;
        for (let row = 0; row < global.screen.workspace_grid.rows; ++row) {
            x     = box.x1;
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
            }
            prevY = childBox.y2 + this._itemSpacing;
            y += this._childHeight + this._itemSpacing;
        }
    },

    _redisplay: function () {
        //log('redisplay, direction ' + this._direction + ', going to ' + this._activeWorkspaceIndex);
        this._list.destroy_all_children();

        for (let i = 0; i < global.screen.n_workspaces; i++) {
            let indicator = null;

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
            if (this._settings.get_boolean(Prefs.KEY_SHOW_WORKSPACE_LABELS)) {
                let name = Meta.prefs_get_workspace_name(i);

                indicator.child = new St.Label({
                    text: name,
                    style_class: 'ws-switcher-label'
                });
            }

            this._list.add_actor(indicator);
        }

        let workArea =
            Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);

        if (this._settings.get_boolean(Prefs.KEY_SHOW_WORKSPACE_THUMBNAILS)) {
            let [containerMinHeight, containerNatHeight] =
                this._thumbnailsBox.actor.get_preferred_height(global.screen_width);
            let [containerMinWidth, containerNatWidth] =
                this._thumbnailsBox.actor.get_preferred_width(containerNatHeight);

            this._thumbnailsBox.actor.x = workArea.x + Math.floor((workArea.width - containerNatWidth) / 2);
            this._thumbnailsBox.actor.y = workArea.y + Main.panel.actor.height +
                Math.floor(((workArea.height - Main.panel.actor.height) -
                            containerNatHeight) / 2);
        } else {
            let [containerMinHeight, containerNatHeight] =
                this._container.get_preferred_height(global.screen_width);
            let [containerMinWidth, containerNatWidth] =
                this._container.get_preferred_width(containerNatHeight);

            this.actor.x = workArea.x + Math.floor((workArea.width - containerNatWidth) / 2);
            this.actor.y = workArea.y + Main.panel.actor.height +
                Math.floor(((workArea.height - Main.panel.actor.height) -
                            containerNatHeight) / 2);
        }
    },

    /**
     * _onTimeout is automatically called by the parent class WorkspaceSwitcherPopup
     */
    _onTimeout: function () {
        Mainloop.source_remove(this._timeoutId);
        this._timeoutId = 0;

        Tweener.addTween( (this._settings.get_boolean(Prefs.KEY_SHOW_WORKSPACE_THUMBNAILS)) ? this._thumbnailsBox.actor : this._container,
            {
                opacity: 0,
                time: ANIMATION_TIME,
                transition: 'easeOutQuad',
                onCompleteScope: this,
                onComplete: function() {
                    this.destroy();
                }
            }
        );
        return GLib.SOURCE_REMOVE;
    },

    destroy: function () {
        if (this._timeoutId)
            Mainloop.source_remove(this._timeoutId);
        this._timeoutId = 0;

        if (this._settings.get_boolean(Prefs.KEY_SHOW_WORKSPACE_THUMBNAILS)) {
            this._thumbnailsBox._destroyThumbnails();
            this._thumbnailsBox.destroy();
        }

        for (let i = 0; i < this._globalSignals.length; i++)
            global.screen.disconnect(this._globalSignals[i]);

        this.actor.destroy();

        this.emit('destroy');
    }

});

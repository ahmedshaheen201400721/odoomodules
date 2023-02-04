odoo.define('web.KanbanRendererMobile', function (require) {
"use strict";

/**
 * The purpose of this file is to improve the UX of grouped kanban views in
 * mobile. It includes the KanbanRenderer (in mobile only) to only display one
 * column full width, and enables the swipe to browse to the other columns.
 */

var config = require('web.config');
if (!config.device.isMobile) {
    return;
}
var core = require('web.core');
var KanbanRenderer = require('web.KanbanRenderer');
var KanbanTabsMobileMixin = require('web.KanbanTabsMobileMixin');

var _t = core._t;
var qweb = core.qweb;

KanbanRenderer.include(Object.assign({}, KanbanTabsMobileMixin, {
    custom_events: _.extend({}, KanbanRenderer.prototype.custom_events || {}, {
        quick_create_column_created: '_onColumnAdded',
    }),
    events: _.extend({}, KanbanRenderer.prototype.events, {
        'click .o_kanban_mobile_tab': '_onMobileTabClicked',
        'click .o_kanban_mobile_add_column': '_onMobileQuickCreateClicked',
    }),
    ANIMATE: true, // allows to disable animations for the tests
    /**
     * @override
     */
    init: function () {
        this._super.apply(this, arguments);
        this.activeColumnIndex = 0; // index of the currently displayed column
        this._lastGroupedByField = null;
        this._scrollPosition = null;
    },
    /**
     * As this renderer defines its own scrolling area (the column in grouped
     * mode), we override this hook to restore the scroll position like it was
     * when the renderer has been last detached.
     *
     * @override
     */
    on_attach_callback: function () {
        if (this._scrollPosition && this.state.groupedBy.length && this.widgets.length) {
            var $column = this.widgets[this.activeColumnIndex].$el;
            $column.scrollLeft(this._scrollPosition.left);
            $column.scrollTop(this._scrollPosition.top);
        }
        this._computeTabPosition(this.widgets, this.activeColumnIndex, this.$('.o_kanban_mobile_tabs'));
        this._super.apply(this, arguments);
    },
    /**
     * As this renderer defines its own scrolling area (the column in grouped
     * mode), we override this hook to store the scroll position, so that we can
     * restore it if the renderer is re-attached to the DOM later. Also, we use
     * this hook to restore groupedBy column swipe position if groupedBy field
     * is not changed.
     *
     * @override
     */
    on_detach_callback: function () {
        if (this.state.groupedBy.length && this.widgets.length) {
            var $column = this.widgets[this.activeColumnIndex].$el;
            this._scrollPosition = {
                left: $column.scrollLeft(),
                top: $column.scrollTop(),
            };
        } else {
            this._scrollPosition = null;
        }
        this._super.apply(this, arguments);
    },

    //--------------------------------------------------------------------------
    // Public
    //--------------------------------------------------------------------------

    /**
     * Displays the quick create record in the active column
     * override to open quick create record in current active column
     *
     * @override
     * @returns {Promise}
     */
    addQuickCreate: function () {
        if(this._canCreateColumn() && !this.quickCreate.folded) {
            this._onMobileQuickCreateClicked();
        }
        return this.widgets[this.activeColumnIndex].addQuickCreate();
    },

    /**
     * Overrides to restore the left property and the scrollTop on the updated
     * column, and to enable the swipe handlers
     *
     * @override
     */
    updateColumn: function (localID) {
        var index = _.findIndex(this.widgets, {db_id: localID});
        var $column = this.widgets[index].$el;
        var scrollTop = $column.scrollTop();
        return this._super.apply(this, arguments)
            .then(() => this._layoutUpdate(false))
            // required when clicking on 'Load More'
            .then(() => $column.scrollTop(scrollTop));
    },

    //--------------------------------------------------------------------------
    // Private
    //--------------------------------------------------------------------------

    /**
     * Check if we use the quick create on mobile
     * @returns {boolean}
     * @private
     */
    _canCreateColumn: function() {
        return this.quickCreateEnabled && this.quickCreate && this.widgets.length;
    },

    /**
     * Update the columns positions
     *
     * @private
     * @param {boolean} [animate=false] set to true to animate
     */
    _computeColumnPosition: function (animate) {
        if (this.widgets.length) {
            // check rtl to compute correct css value
            const rtl = _t.database.parameters.direction === 'rtl';

            // display all o_kanban_group
            this.$('.o_kanban_group').show();

            const $columnAfter = this._toNode(this.widgets.filter((widget, index) => index > this.activeColumnIndex));
            const promiseAfter = this._updateColumnCss($columnAfter, rtl ? {right: '100%'} : {left: '100%'}, animate);

            const $columnBefore = this._toNode(this.widgets.filter((widget, index) => index < this.activeColumnIndex));
            const promiseBefore = this._updateColumnCss($columnBefore, rtl ? {right: '-100%'} : {left: '-100%'}, animate);

            const $columnCurrent = this._toNode(this.widgets.filter((widget, index) => index === this.activeColumnIndex));
            const promiseCurrent = this._updateColumnCss($columnCurrent, rtl ? {right: '0%'} : {left: '0%'}, animate);

            promiseAfter
                .then(promiseBefore)
                .then(promiseCurrent)
                .then(() => {
                    $columnAfter.hide();
                    $columnBefore.hide();
                });
        }
    },

    /**
     * Define the o_current class to the current selected kanban (column & tab)
     *
     * @private
     */
    _computeCurrentColumn: function () {
        if (this.widgets.length) {
            var column = this.widgets[this.activeColumnIndex];
            if (!column) {
                return;
            }
            var columnID = column.id || column.db_id;
            this.$('.o_kanban_mobile_tab.o_current, .o_kanban_group.o_current')
                .removeClass('o_current');
            this.$('.o_kanban_group[data-id="' + columnID + '"], ' +
                   '.o_kanban_mobile_tab[data-id="' + columnID + '"]')
                .addClass('o_current');
        }
    },

    /**
     * Enables swipe event on the current column
     *
     * @private
     */
    _enableSwipe: function () {
        var self = this;
        var step = _t.database.parameters.direction === 'rtl' ? -1 : 1;
        this.$el.swipe({
            excludedElements: ".o_kanban_mobile_tabs",
            swipeLeft: function () {
                var moveToIndex = self.activeColumnIndex + step;
                if (moveToIndex < self.widgets.length) {
                    self._moveToGroup(moveToIndex, self.ANIMATE);
                }
            },
            swipeRight: function () {
                var moveToIndex = self.activeColumnIndex - step;
                if (moveToIndex > -1) {
                    self._moveToGroup(moveToIndex, self.ANIMATE);
                }
            }
        });
    },

    /**
     * @override
     */
    _getTabWidth : function (column) {
        var columnID = column.id || column.db_id;
        return this.$('.o_kanban_mobile_tab[data-id="' + columnID + '"]').outerWidth();
    },

    /**
     * Update the kanban layout
     *
     * @private
     * @param {boolean} [animate=false] set to true to animate
     */
    _layoutUpdate : function (animate) {
        this._computeCurrentColumn();
        this._computeTabPosition(this.widgets, this.activeColumnIndex, this.$('.o_kanban_mobile_tabs'));
        this._computeColumnPosition(animate);
    },

    /**
     * Moves to the given kanban column
     *
     * @private
     * @param {integer} moveToIndex index of the column to move to
     * @param {boolean} [animate=false] set to true to animate
     * @returns {Promise} resolved when the new current group has been loaded
     *   and displayed
     */
    _moveToGroup: function (moveToIndex, animate) {
        if (moveToIndex < 0 || moveToIndex >= this.widgets.length) {
            this._layoutUpdate(animate);
            return Promise.resolve();
        }
        this.activeColumnIndex = moveToIndex;
        this._lastGroupedByField = this.columnOptions.groupedBy;
        var column = this.widgets[this.activeColumnIndex];
        if (column.data.isOpen) {
            this._layoutUpdate(animate);
        } else {
            // Unfold column and fetch records
            this.trigger_up('column_toggle_fold', {
                db_id: column.db_id,
                onSuccess: () => this._layoutUpdate(animate)
            });
        }
        this._enableSwipe();
        return Promise.resolve();
    },
    /**
     * override to avoid display of example background
     */
    _renderExampleBackground: function () {},
    /**
     * @override
     * @private
     */
    _renderGrouped: function (fragment) {
        var self = this;
        var newFragment = document.createDocumentFragment();
        this._super.apply(this, [newFragment]);
        this.defs.push(Promise.all(this.defs).then(function () {
            var data = [];
            _.each(self.state.data, function (group) {
                if (!group.value) {
                    group = _.extend({}, group, {value: _t('Undefined')});
                    data.unshift(group);
                } else {
                    data.push(group);
                }
            });

            var kanbanColumnContainer = document.createElement('div');
            kanbanColumnContainer.classList.add('o_kanban_columns_content');
            kanbanColumnContainer.appendChild(newFragment);
            fragment.appendChild(kanbanColumnContainer);
            if (data.length) {
                $(qweb.render('KanbanView.MobileTabs', {
                    data: data,
                    quickCreateEnabled: self._canCreateColumn()
                })).prependTo(fragment);
            }
        }));
    },

    /**
     * @override
     * @private
     */
    _renderView: function () {
        var self = this;
        return this._super.apply(this, arguments).then(function () {
            if (self.state.groupedBy.length) {
                // if the groupedBy is changed, force first column for kanban view
                if (self._lastGroupedByField !== self.columnOptions.groupedBy) {
                    self.activeColumnIndex = 0;
                }
                return self._moveToGroup(self.activeColumnIndex);
            } else {
                if(self._canCreateColumn()) {
                    self._onMobileQuickCreateClicked();
                }
                return Promise.resolve();
            }
        });
    },

    /**
     * Retrieve the Jquery node (.o_kanban_group) for a list of a given widgets
     *
     * @private
     * @param widgets
     * @returns {jQuery} the matching .o_kanban_group widgets
     */
    _toNode: function (widgets) {
        const selectorCss = widgets
            .map(widget => '.o_kanban_group[data-id="' + (widget.id || widget.db_id) + '"]')
            .join(', ');
        return this.$(selectorCss);
    },

    /**
     * Update the given column to the updated positions
     *
     * @private
     * @param $column The jquery column
     * @param cssProperties Use to update column
     * @param {boolean} [animate=false] set to true to animate
     * @return {Promise}
     */
    _updateColumnCss: function ($column, cssProperties, animate) {
        if (animate) {
            return new Promise(resolve => $column.animate(cssProperties, 'fast', resolve));
        } else {
            $column.css(cssProperties);
            return Promise.resolve();
        }
    },

    //--------------------------------------------------------------------------
    // Handlers
    //--------------------------------------------------------------------------

    /**
     * @private
     */
    _onColumnAdded: function () {
        this._computeTabPosition(this.widgets, this.activeColumnIndex, this.$('.o_kanban_mobile_tabs'));
        if(this._canCreateColumn() && !this.quickCreate.folded) {
            this.quickCreate.toggleFold();
        }
    },

    /**
     * @private
     */
    _onMobileQuickCreateClicked: function() {
        this.$('.o_kanban_group').toggle();
        this.quickCreate.toggleFold();
    },
    /**
     * @private
     * @param {MouseEvent} event
     */
    _onMobileTabClicked: function (event) {
        if(this._canCreateColumn() && !this.quickCreate.folded) {
            this.quickCreate.toggleFold();
        }
        this._moveToGroup($(event.currentTarget).index(), true);
    },
}));

});

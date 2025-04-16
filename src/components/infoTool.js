/**
 * Toolbar icon and subtoolbar heavily inspired by the L.OpacitiesAction action.
 * opens a div where text can be displayed, links clicked, etc.
 * can probably be way simplified, but this works for now.
 */


export const infoTool = L.Toolbar2.Action.extend({
    options: {
        toolbarIcon: {
            className: 'pi pi-times',
        },
        /* Use L.Toolbar2 for sub-toolbars. A sub-toolbar is,
         * by definition, contained inside another toolbar, so it
         * doesn't need the additional styling and behavior of a
         * L.Toolbar2.Control or L.Toolbar2.Popup.
         */
        subToolbar: new L.Toolbar2({
            // must be in an array otherwise it won't work
            actions: [L.EditAction.extend({
                options: {
                    toolbarIcon: {
                        html: '<span>cc</span><a href="https://www.google.com">Google</a>',
                        tooltip: "Salut",
                        className: "more-info-popup",
                    },
                },
                addHooks() {
                    alert("Salut");
                },
            })],
        })
    },
    addHooks() {
        const link = this._link;
        if (L.DomUtil.hasClass(link, "subtoolbar_enabled")) {
            L.DomUtil.removeClass(link, "subtoolbar_enabled");
            setTimeout(() => {
                this.options.subToolbar._hide();
            }, 100);
        } else {
            L.DomUtil.addClass(link, "subtoolbar_enabled");
        }

        L.IconUtil.toggleXlink(link, "opacities", "cancel");
        L.IconUtil.toggleTitle(link, "Make Image Transparent", "Cancel");
    },
});
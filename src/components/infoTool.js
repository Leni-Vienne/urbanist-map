/**
 * Toolbar icon and subtoolbar heavily inspired by the L.OpacitiesAction action.
 * opens a div where text can be displayed, links clicked, etc.
 * can probably be way simplified, but this works for now.
 */

// Add custom CSS scripts and overwrites. Pending for better implementation of CSSStyleSheet in browsers.
const subtoolbarCss = new CSSStyleSheet();
subtoolbarCss.replaceSync(
    `.more-info-popup {
        box-sizing: border-box !important;
        display: block !important;
        width: 200px !important;
        height: 30px !important;
        line-height: 30px !important;
        padding: 0 !important;
        text-align: center !important;
        text-decoration: none !important;
        background-color: white;
        border:transparent !important;
        font-size: 12px !important;
        font-weight: bold !important;
        color:#0087A8 !important;
        float: none !important;
        margin: auto !important;
        z-index:900 !important;
     
      }
    `
);

subtoolbarCss.insertRule(
    `.leaflet-toolbar-1 li:first-child a {
        border-radius: 4px 4px 0px 0px !important;
    }`
);
document.adoptedStyleSheets = [subtoolbarCss];


// must be in an array otherwise it won't work
let tool = [L.EditAction.extend({
    options: {
        toolbarIcon: {
            html: '<span>cc</span>',
            tooltip: "Salut",
            className: "more-info-popup",
            style:
                "background-color:rgb(255,255,255,1);",
        }
    },
    addHooks() {
        alert("Salut");
    },
})]

L.OpacitiesToolbar2 = L.Toolbar2.extend({
    options: {
        className: "",
        filter: function () {
            return true;
        },
        actions: [],
        style: `translate(-1px, -60px)`,
    },

    appendToContainer(container) {
        let baseClass = this.constructor.baseClass + "-" + this._calculateDepth();
        let className = baseClass + " " + this.options.className;
        let Action;
        let action;
        let i;
        let j;
        let l;
        let m;

        this._container = container;
        this._ul = L.DomUtil.create("ul", className, container);
        this._ul.style.transform = this.options.style ? this.options.style : "";

        // Ensure that clicks, drags, etc. don't bubble up to the map.
        // These are the map events that the L.Draw.Polyline handler listens for.
        // Note that L.Draw.Polyline listens to 'mouseup', not 'mousedown', but
        // if only 'mouseup' is silenced, then the map gets stuck in a halfway
        // state because it receives a 'mousedown' event and is waiting for the
        // corresponding 'mouseup' event.
        this._disabledEvents = [
            "click",
            "mousemove",
            "dblclick",
            "mousedown",
            "mouseup",
            "touchstart",
        ];

        for (j = 0, m = this._disabledEvents.length; j < m; j++) {
            L.DomEvent.on(
                this._ul,
                this._disabledEvents[j],
                L.DomEvent.stopPropagation
            );
        }

        /* Instantiate each toolbar action and add its corresponding toolbar icon. */
        for (i = 0, l = this.options.actions.length; i < l; i++) {
            Action = this._getActionConstructor(this.options.actions[i]);

            action = new Action();
            action._createIcon(this, this._ul, this._arguments);
        }
    },
});

// to have the toolbar icon and be able to open and close the subtoolbar
export let infoTool = L.EditAction.extend({
    initialize(map, overlay, options) {
        const edit = overlay.editing;
        const mode = edit._mode;

        options = options || {};
        options.toolbarIcon = {
            svg: false,
            html: `<div class="iconStyle opacityIconStyle">
<svg width="11" height="13" viewBox="0 0 11 13" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M9.11013 4.24777L5.5915 0.735352L2.07286 4.24777C1.14461 5.17897 0.621772 6.43914 0.618164 7.75397C0.618164 8.9973 1.10306 10.309 2.07286 11.2788C2.53434 11.742 3.0827 12.1094 3.68651 12.3602C4.29032 12.6109 4.93769 12.74 5.5915 12.74C6.2453 12.74 6.89267 12.6109 7.49648 12.3602C8.10029 12.1094 8.64866 11.742 9.11013 11.2788C10.0799 10.309 10.5648 8.9973 10.5648 7.75397C10.5648 6.51064 10.0799 5.21757 9.11013 4.24777ZM1.8615 7.97777C1.86771 6.73443 2.24693 5.94492 2.95563 5.24243L5.5915 2.55062L8.22736 5.27352C8.93606 5.96978 9.31528 6.73443 9.3215 7.97777H1.8615Z" fill="none"/>
</svg>


</div>`,
            tooltip: "Set custom opacity",
            className: mode === "lock" ? "disabled" : "",
        };

        options.subToolbar = new L.OpacitiesToolbar2({
            actions: tool,
        });

        L.DistortableImage.action_map.o = mode === "lock" ? "" : "_setOpacities";

        L.EditAction.prototype.initialize.call(this, map, overlay, options);
    },

    addHooks() {
        const link = this._link;
        if (L.DomUtil.hasClass(link, "subtoolbar_enabled")) {
            L.DomUtil.removeClass(link, "subtoolbar_enabled");
            setTimeout(() => {
                this.options.subToolbar._hide();
                console.log("cache")
            }, 100);
        } else {
            L.DomUtil.addClass(link, "subtoolbar_enabled");
        }

        L.IconUtil.toggleXlink(link, "opacities", "cancel");
        L.IconUtil.toggleTitle(link, "Make Image Transparent", "Cancel");
    },
});
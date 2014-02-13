/*jslint indent:2, plusplus:true, nomen: true, vars: true */
/*globals document, window, console */

/**
 @class Mimic the behaviour of iOS springboard.
 @param container A dom elements whose children will comprise the sliding this.panels
 @param this.options An object containing this.options to override default settings.  The
   possible option values and their defaults are listed below.
   <ul>
     <li>animTime: Time in milliseconds used when automatically sliding pages,
       such as when using the next() or prev() methods, or when the user slides
       a page part way across the screen and releases.
       <br/><strong>default: 500</strong>
     </li>
     <li>panelClass: A dom class name.  Used when initialising a slidepanel.  Elements
       within the container with this class name will be made slideable.  This is empty
       by default, as pages can be added manually.
       <br/><strong>default: ''</strong>
     </li>
     <li>constraintScale: When sliding a page against a constraint (such as trying to
       slide past the beginning or end of a series of this.panels), the amount the panel
       slides will be divided by this scale factor to indicate to the user that a
       constraint has been reached.  If set to 2, for example, the panel will slide
       1px for ever 2px that the user drags.
       <br/><strong>default: 3</strong>
     </li>
     <li>currentPanelClass: Class applied to the currently visible panel.
       <br/><strong>default: 'currentPanel'</strong>
     </li>
     <li>give: this.panels do not being moving until the user has dragged on the page a little.
       This behaviour is intended to reduce the chance of the user accidentally
       initiating dragging whilst tapping a control on the page.  This is the pixel value
       threshold the user must move before panel dragging beings.
       <br/><strong>default: 15</strong>
     </li>
     <li>portionOfPageBeforeScroll: Portion of the page the user must drag across before
       releasing will scroll to the next page.  With the default of 2, the user must drag
       half way across the page, with a value of 3 the user would only need to drag a
       third of the way across the page (2 is the behaviour of Springboard in iOS, 3 is
       used by the ViewPager class in Android).
       <br/><strong>default: 2</strong>
     </li>
  </ul>
*/

(function(window) {

  'use strict';

  var FORWARD = 1;
  var NEUTRAL = 0;
  var BACKWARD = -1;
  
  var HAS_TOUCH = !!('ontouchstart' in window);
  var START_EVENT = HAS_TOUCH ? 'touchstart' : 'mousedown';
  var MOVE_EVENT = HAS_TOUCH ? 'touchmove' : 'mousemove';
  var END_EVENT = HAS_TOUCH ? 'touchend' : 'mouseup';
  var CANCEL_EVENT = 'touchcancel';
  
  var START_MOVE_EVENT = 'slidepanelstartmove'
  var END_MOVE_EVENT = 'slidepanelendmove';
  var ATTACH_EVENT = 'slidepanelattachevent';
  
  var IS_ANDROID = (/android/gi).test(navigator.appVersion);
  
  //
  // Number of panels attached to the page at any one time
  //
  var PANEL_LIMIT = 3;
  var DISPLAY_RANGE = Math.floor(PANEL_LIMIT / 2);

  //
  // Determine the appropriate transform property
  //
  var tempStyle = document.createElement('div').style;
  var browser = '';
  var cssPrefix = 'transform';
  ['t', 'webkitT', 'MozT', 'msT', 'OT'].some(function(prefix) {
    if (prefix + 'ransform' in tempStyle) {
      browser = prefix.substr(0, prefix.length - 1);
      cssPrefix = prefix.length === 1 ? '' : '-' + browser.toLowerCase() + '-';
      return true;
    }
  });
  
  var	transformStyle = prefixedStyle('transform');
  var transitionStyle = prefixedStyle('transition');
  
  var transitionEndEvent = {
    '' : 'transitionend',
    'webkit' : 'webkitTransitionEnd',
    'Moz' : 'transitionend',
    'ms' : 'MSTransitionEnd',
    'O' : 'oTransitionEnd'
	}[browser];

  window.SlidePanel = function(container, options) {

    this.options = extend({
      animTime: 300,
      panelClass: 'panel',
      currentPanelClass: 'currentPanel',
      offscreenClass: 'offscreen',
      constraintScale: 3,
      threshold: 8,
      portionOfPageBeforeScroll: 2,
      interrupt: true,
      cycle: false
    }, options);

    this.container = container;
    this.points = [];
    this.panels = [];
    this.boundaryFunction = null;
    this.onDisableFunction = null;
    this.onEnableFunction = null;

    this.reset();

    this.container.addEventListener(START_EVENT, this);
    document.addEventListener(END_EVENT, this);
    document.addEventListener(CANCEL_EVENT, this);
  };

  window.SlidePanel.prototype = {
    reset: function() {
      this.panels.length = 0;
      this.resetOffset = false;
      this.enabled = true;
      this.isMoving = false;
      this.isCoasting = false;
      this.index = 0;
      this.lastIndex = -1;
      this.startOffset = 0;
      this.enabled = true;
      this.successiveSwipes = 0;
      this.transitionEndFunction = null;
      this.points.length = 0;
      this.transformX(this.container, 0);
      while (this.container.children.length) {
        this.container.removeChild(this.container.firstChild);
      }
    },

    handleEvent: function(e) {
      if (this.enabled) {
    		switch (e.type) {
    			case START_EVENT:
    				this.startEvent(e);
    				break;
    			case MOVE_EVENT:
    				this.moveEvent(e);
    				break;
    			case END_EVENT:
    				this.endEvent(e);
    				break;
    			case CANCEL_EVENT:
      		  this.cancel();
    			  break;
    		}
      }
    },

    startEvent: function(e) {
      if (!this.options.interrupt && this.isCoasting) return;

      var point = HAS_TOUCH ? e.touches.length === 1 && e.touches[0] : e;
      if (point && !point.button) {
        this.runTransitionEnd();
        var offset = this.getX();
        this.isMoving = !!offset;
        //
        // Android - setting duration to zero doesn't stop existing transition.  Use 1ms instead.
        //
        this.transformX(this.container, offset + 'px', IS_ANDROID ? 1 : 0);
        if (!this.options.cycle && (
           (this.index === 0 && offset > 0) || (this.index === this.getLastIndex() && offset < 0) ) ) {
          offset *= this.options.constraintScale;
        }
        this.startOffset = point.pageX - offset;
        this.points[0] = this.points[1] = point.pageX;
        this.priorTime = +new Date;
        document.addEventListener(MOVE_EVENT, this);
      }
    },

    moveEvent: function(e) {
      var point = HAS_TOUCH ? e.touches[0] : e;
      if (this.resetOffset) {
        this.points[0] = this.points[1] = this.startOffset = point.pageX;
        this.resetOffset = false;
      }
      var newX = point.pageX - this.startOffset;

      //
      // Don't start drag until a certain movement threshold has been reached
      //
      if (this.isMoving || Math.abs(newX) > this.options.threshold) {
        if (!this.isMoving) {
          var offset = newX > 0 ? -this.options.threshold : this.options.threshold;
          this.startOffset -= offset;
          this.points[1] -= offset;
          newX += offset;
          this.trigger(START_MOVE_EVENT, this.getIndex(), newX > 0 ? BACKWARD : FORWARD);
          this.isMoving = true;
        }

        if ( !this.options.cycle && (
               (newX > 0 && this.index === 0) ||
               (newX < 0 && this.index >= this.getLastIndex()) ) ) {
          newX = Math.round(newX / this.options.constraintScale);

          //
          // Boundary function can return false to cancel normal movement
          //
          if (this.boundaryFunction && !this.boundaryFunction(newX, this.startOffset)) {
            newX = 0;
            this.doResetOffset();
          }
        }

        this.transformX(this.container, newX + 'px');
        this.priorTime = +new Date;
        this.points.shift();
        this.points[1] = point.pageX;
      }
    },

    endEvent: function(e) {
      var point = HAS_TOUCH ? e.changedTouches[0] : e;
      document.removeEventListener(MOVE_EVENT, this);
      if (this.isMoving) {

        var x = this.points[0] - this.startOffset;
        var newX = point.pageX - this.startOffset;
        var deltaX = newX - x;
        var deltaTime = (+new Date) - this.priorTime;
        var velocity = deltaX / deltaTime * 100;
        var width = this.getWidth();
        var targetX = newX;

        if (velocity > 20) {
          var targetX = width;
        } else if (velocity < -20) {
          var targetX = -width;
        }

        var scale = IS_ANDROID ? 0.7 : 1;
        var duration = (width / Math.abs(velocity)) * 100;
        duration = Math.max(300 * scale, Math.min(500 * scale, duration));

        var direction = NEUTRAL;
        if (targetX > width / this.options.portionOfPageBeforeScroll) {
          direction = BACKWARD;
        } else if (targetX < -width / this.options.portionOfPageBeforeScroll) {
          direction = FORWARD;
        }

        this.move(direction, duration);
        this.endMovement();
      } else {
        this.isCoasting = false;
      }
    },

    cancel: function() {
      this.container.removeEventListener(MOVE_EVENT, this);
      this.move(NEUTRAL, 0);
    },

    /** @private
     Animate to a panel.
     @param targetPanelOffset FORWARD, NEUTRAL, BACK, or a specific offset for the next panel to move
       Positive numbers move forwards, Negative numbers move backwards. NEUTRAL or 0 returns
       the current panel to center of the display.
     @param duration time to animate over.
     @param fn Callback function to exectute after transition has take place.
     over another
    */
    move: function(targetPanelOffset, duration, callback) {
      var lastIndex = this.getLastIndex();
      var targetPanelIndex = this.index + targetPanelOffset;
      var beforeFirst = targetPanelIndex < 0;
      var afterLast = targetPanelIndex > lastIndex;
      var boundaryMove = false;

      if (!this.options.cycle && (beforeFirst || afterLast)) {
        if (this.successiveSwipes) {
          if ( (beforeFirst && this.boundaryBackFunction) || (afterLast && this.boundaryNextFunction) ) {
            targetPanelIndex = beforeFirst ? 0 : lastIndex;
            targetPanelOffset = NEUTRAL;
            boundaryMove = true;
            duration /= this.successiveSwipes;
          } else {
            return;
          }
        } else {
          targetPanelIndex = Math.max(0, Math.min(lastIndex, targetPanelIndex));
        }
      } else {
        targetPanelIndex = targetPanelIndex >= 0 ? targetPanelIndex : lastIndex + targetPanelIndex + 1;
      }

      this.isCoasting = true;
      var width = this.getWidth();
      var x = this.getX();
      var range = null;

      if (this.successiveSwipes) {
        range = x / width;
        range = range >= 0 ? Math.ceil(range) : Math.floor(range);
        range += range >= 0 ? 1 : -1;
      }

      var xPos = x + width * this.getDistance(targetPanelIndex);
      this.transformX(this.container, xPos + 'px');
      this.setIndex(targetPanelIndex, true);
      this.reposition(range, true);
      duration = boundaryMove ? duration * Math.abs(xPos) / width : duration;

      this.transitionEndFunction = function transitionEnd() {
        this.isCoasting = false;
        this.transitionEndFunction = null;
        this.trigger(END_MOVE_EVENT, targetPanelIndex, targetPanelOffset);
        callback && callback();
      }

      var self = this;
      window.setTimeout(function() {
        self.transformX(self.container, 0, duration, function endMove() {
          self.successiveSwipes = 0;
          !self.getX() && self.reposition();
          self.runTransitionEnd();
          boundaryMove && beforeFirst && self.boundaryBackFunction && self.boundaryBackFunction(duration);
          boundaryMove && afterLast && self.boundaryNextFunction && self.boundaryNextFunction(duration);
        }, boundaryMove ? 'linear' : null);
      },1);
    },

    //
    // Ensure only panels within the limit are positioned within the container
    //
    reposition: function(panelRange, retain) {
      var range = Math.abs(panelRange || DISPLAY_RANGE);
      for (var ii = 0; ii < this.panels.length; ++ii) {
        var panel = this.panels[ii];
        if (panel) {
          var distance = this.getDistance(ii);
          var absDistance = Math.abs(distance);
          if (absDistance <= (panelRange && panelRange * distance < 0 ? range : 1) ) {
            this.transformX(panel, distance * 100 + '%');

            if (!absDistance) {
              panel.classList.add(this.options.currentPanelClass);
              panel.classList.remove(this.options.offscreenClass);
            } else {
              panel.classList.remove(this.options.currentPanelClass);
              panel.classList.add(this.options.offscreenClass);
            }

            if (!panel.parentNode) {
              this.container.appendChild(panel);
              this.trigger(ATTACH_EVENT, ii, 0)
            }

          } else if (panel.parentNode) {
            if (retain) {
              panel.style[transformStyle] = 'translate3d(0, -200%, 0)';
            } else {
              panel.parentNode.removeChild(panel)
            }
          }

        }
      }
    },

    goto: function(index, duration, callback) {
      index = index < 0 ? this.getLastIndex() + 1 + index : index;
      this.move(index - this.index, duration, callback);
    },

    runTransitionEnd: function() {
      if (this.getX()) {
        this.successiveSwipes++;
      }
      return this.transitionEndFunction && this.transitionEndFunction.call(this);
    },

    next: function(animTime, callback) {
      this.shift(FORWARD, animTime, callback);
    },

    back: function(animTime, callback) {
      this.shift(BACKWARD, animTime, callback);
    },

    shift: function(position, animTime, callback) {
      if (!this.enabled || (!this.options.interrupt && this.isCoasting)) return;
      this.runTransitionEnd();
      this.trigger(START_MOVE_EVENT, this.getIndex(), position);
      this.move(position, (animTime !== undefined ? animTime : this.options.animTime), callback);
    },

    getDistance: function(index) {
      var lastIndex = this.getLastIndex();
      if (index > lastIndex) {
        return 10000;
      }
      var distance = index - this.index;
      var end = this.options.cycle ? lastIndex / 2 : lastIndex;
      if (distance > end) {
        distance -= lastIndex + 1;
      } else if (distance < -end) {
        distance += lastIndex + 1;
      }
      return distance;
    },

    /**
     Programmatically add a panel
     @param panel Panel to add
     @param index Add the panel at the specified index.  If the index is not
       specified, the panel is added at the end.
    */
    add: function(panel, index) {
      this.options.panelClass && panel.classList.add(this.options.panelClass);
      var first = !this.panels.length;

      first && this.setIndex(0);
      if (!first && this.lastIndex >= 0) {
        this.lastIndex++;
      }

      if (index || index === 0) {
        this.panels.splice(index, 0, panel);
      } else {
        this.panels.push(panel);
      }
      return panel;
    },

    /**
     Remove a panel
     @param panel Either a dom element or an index
     @param moveToPrev Indicates whether the previous panel should be displayed
      if the current panel is removed
    */
    remove: function(panel, moveToPrev) {
      if (parseFloat(panel) === parseInt(panel, 10) && !isNaN(panel)) {
        panel = this.panels[panel];
      }
      var index = this.getIndex(panel);
      if (index >= 0) {
        if (index === this.index && moveToPrev) {
        } else if (index < this.index) {
          this.index--;
        }
        this.panels.splice(index, 1);
        if (this.lastIndex > 0) {
          this.lastIndex--;
        }
        panel.parentNode && panel.parentNode.removeChild(panel);
        this.reposition();
      }
    },

    /**
     Reset offset is used when passing control back to the slide panel.  Upon return
     we can't assume that the original offset is valid anymore.  Even if it's off by
     a pixel, this is enough to cause problems.  This function indicates that the
     offset should be reset on the next move event - we can't reset it here directly
     since it requires values to be read from the next touch event.
    */
    doResetOffset: function() {
      this.resetOffset = true;
    },

    enable: function() {
      this.enabled = true;
      this.onEnableFunction && this.onEnableFunction();
    },

    disable: function() {
      this.enabled = false;
      this.onDisableFunction && this.onDisableFunction();
    },

    endMovement: function() {
      this.isMoving = false;
    },

    onDisable: function(fn) {
      this.onDisableFunction = fn;
    },

    onEnable: function(fn) {
      this.onEnableFunction = fn;
    },

    /**
     Returns the index of the current panel if no parameter, or the specified panel
    */
    getIndex: function(panel) {
      return panel ? this.panels.indexOf(panel) : this.index;
    },

    setIndex: function(newIndex, preventReposition) {
      var oldIndex = this.getIndex();
      if (newIndex !== oldIndex) {
        this.index = newIndex;
        !preventReposition && this.reposition();
      }
    },

    /**
     @param className Only panels with the specified classname are returned (optional)
     @param attached Only panels attached to the dom are returned if true
    */
    getPanels: function(className, attached) {
      var panels = this.panels;
      if (className && this.panels) {
        panels = this.panels.filter(function(panel) {
          return panel.classList.contains(className) && (!attached || panel.parentNode);
        });
      }
      return panels;
    },

    getPanel: function(index, className) {
      var panels = className ? this.getPanels(className) : this.panels;
      return panels && panels[typeof index !== 'undefined' ? index : this.index];
    },

    getWidth: function() {
      return this.container.offsetWidth;
    },

    setLastIndex: function(index) {
      this.lastIndex = typeof index === 'undefined' ? -1 : index;
    },

    getLastIndex: function() {
      return this.lastIndex >= 0 ? this.lastIndex : Math.max(0, this.panels.length - 1);
    },

    onStart: function(fn) {
      this.addEvent(START_MOVE_EVENT, fn);
    },

    onEnd: function(fn) {
      this.addEvent(END_MOVE_EVENT, fn);
    },

    onAttach: function(fn) {
      this.addEvent(ATTACH_EVENT, fn);
    },

    trigger: function(eventType, index, direction) {
      //
      // W3C Event model IE9+ 
      // 
      var event = document.createEvent('CustomEvent');
      event.initCustomEvent(eventType, true, true, {
        panel: this.getPanel(index),
        index: typeof index === 'undefined' ? this.getIndex : index,
        direction: direction
      });
          
      event.eventName = eventType;
      this.container.dispatchEvent(event);
    },

    onBoundary: function(fn) {
      this.boundaryFunction = fn;
    },

    onBoundaryNext: function(fn) {
      this.boundaryNextFunction = fn;
    },

    onBoundaryBack: function(fn) {
      this.boundaryBackFunction = fn;
    },

    //
    // Assumes that x is either a pixel value or percentage
    //
    transformX: function(element, x, duration, callback, easing) {
      element.style[transitionStyle] = duration ? cssPrefix + 'transform ' + duration + 'ms ' + (easing || 'ease-out') : '';
      element.style[transformStyle] = 'translate3d(' + x + ', 0, 0)';
      if (callback) {
        if (duration) {
          element.addEventListener(transitionEndEvent, function transition() {
            element.removeEventListener(transitionEndEvent, transition);
            callback();
          });
        } else {
          callback();
        }
      }
    },

    getX: function() {
      var transform = window.getComputedStyle(this.container).getPropertyValue(cssPrefix + 'transform');
      return parseInt(transform.split(',')[4] || 0);
    }

  };

	function prefixedStyle(style) {
		return browser ? browser + style.charAt(0).toUpperCase() + style.substr(1) : style;
	}


  function extend(target, obj) {
    if (obj) {
      var keys = Object.keys(obj);
      keys.forEach(function(prop) {
        var val = obj[prop];
        if (val !== null) {
          target[prop] = val;
        }
      }); 
    }
    return target;
  }

})(window);
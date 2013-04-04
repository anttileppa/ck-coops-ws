CKEDITOR.plugins.add('coops-ws', {
  requires : [ 'coops' ],
  init : function(editor) {

    CKEDITOR.coops.WebSocketConnector = CKEDITOR.tools.createClass({
      base : CKEDITOR.coops.Connector,
      $ : function(editor) {
        this.base(editor);

        this._revisionNumber = null;
        this._selectionStyles = {};
        this._clientColorProfiles = {};
        this._selections = {};
        this._selectionCheckPaused = false;
        this._currentColorProfileId = 0;
        this._currentColorProfileCount = 122;

        editor.on("CoOPS:SessionStart", this._onSessionStart, this);
      },
      proto : {
        _handlePatchMessage : function(message) {
          var patch = message.patch;
          var revisionNumber = message.revisionNumber;
          var clientId = message.clientId;

          if (editor.fire("CoOPS:PatchReceived", {
            patch : patch
          })) {
            this._revisionNumber = revisionNumber;
          }
          ;
        },

        _cleanSelectionMarkers : function(clientId) {
          var document = this.getEditor().document;

          if (false && (typeof document.$.querySelectorAll) == 'function') {
            var oldNodes = document.$.querySelectorAll('span[data-coops-selection]');

            for ( var i = 0, l = oldNodes.length; i < l; i++) {
              this._removeSelectionNode(new CKEDITOR.dom.element(oldNodes[i]), true);
            }

            oldNodes = document.$.querySelectorAll('span[data-coops-cursor]');

            for ( var i = 0, l = oldNodes.length; i < l; i++) {
              this._removeSelectionNode(new CKEDITOR.dom.element(oldNodes[i]), false);
            }

          } else {
            var spans = document.getElementsByTag("span");
            for ( var i = spans.count() - 1; i >= 0; i--) {
              var span = spans.getItem(i);
              if (span.getAttribute('data-coops-selection')) {
                this._removeSelectionNode(span, true);
              } else if (span.getAttribute('data-coops-cursor')) {
                this._removeSelectionNode(span, false);
              }
            }
          }
        },
        _removeSelectionNode : function(node, preserveChildren) {
          var parent = node.getParent();
          node.remove(preserveChildren);
          // TODO: Add proper fix, removal of selection nodes generates
          // orphaned text nodes, which does look good but does not match
          // document structure anymore thus braking future selections
          // resetting html content fixes this but is far from optimal or even
          // good solution.
          parent.setHtml(parent.getHtml());
        },

        _getSelectionStyle : function(clientId) {
          if (this._selectionStyles[clientId] == null) {
            this._selectionStyles[clientId] = new CKEDITOR.style({
              element : 'span',
              attributes : {
                'data-coops-selection' : 'true',
                'class' : 'coops-selection-' + this._getClientColorProfile(clientId)
              }
            });
          }

          return this._selectionStyles[clientId];
        },

        _getCursorStyle : function(clientId) {
          if (this._selectionStyles[clientId] == null) {
            this._selectionStyles[clientId] = new CKEDITOR.style({
              element : 'span',
              attributes : {
                'data-coops-cursor' : 'true',
                'class' : 'coops-selection-' + this._getClientColorProfile(clientId)
              }
            });
          }

          return this._selectionStyles[clientId];
        },

        _getClientColorProfile : function(clientId) {
          var colorProfile = this._clientColorProfiles[clientId];
          if (colorProfile == null) {
            colorProfile = this._getNextFreeColorProfileId();
            this._clientColorProfiles[clientId] = colorProfile;
          }

          return colorProfile;
        },

        _getNextFreeColorProfileId : function() {
          this._currentColorProfileId = (this._currentColorProfileId % this._currentColorProfileCount) + 1;
          return this._currentColorProfileId;
        },

        _addSelectionMarkers : function() {
          // TODO: Overlapping selections do not work correctly because
          // DOM changes when markers are added. Ranges should be adjusted
          // accordingly

          var document = this.getEditor().document;
          var selectRanges = new Array();

          // Loop through selections and add all them as ranges into selectRanges array
          for ( var clientId in this._selections) {
            var selections = this._selections[clientId];

            for ( var i = 0, l = selections.length; i < l; i++) {
              var selection = selections[i];
              var startContainer = document.getByAddress(selection.startContainerAddress);
              if (startContainer) {
                var endContainer = document.getByAddress(selection.endContainerAddress);
                if (endContainer) {
                  var commonAncestor = startContainer.getCommonAncestor(endContainer);

                  var range = new CKEDITOR.dom.range(commonAncestor);
                  range.setStart(startContainer, selection.startOffset);
                  range.setEnd(endContainer, selection.endOffset);

                  selectRanges.push({
                    range : range,
                    meta : {
                      clientId : clientId
                    }
                  });
                }
              }
            }
          }

          function compareAddresses(address1, address2) {
            var address1Length = address1.length;
            var address2Length = address2.length;
            for ( var i = 0, l = Math.min(address1Length, address2Length); i < l; i++) {
              var result = address1[i] - address2[i];
              if (result != 0) {
                return result;
              }
            }
            return address1.length - address2.length;
          }

          function compareRangePoint(node1, offset1, node2, offset2) {
            var result = node1.equals(node2) ? 0 : compareAddresses(node1.getAddress(true), node2.getAddress(true));
            if (result != 0) {
              return result;
            }

            return offset1 - offset2;
          }

          selectRanges.sort(function(range1, range2) {
            var result = compareRangePoint(range1.range.startContainer, range1.range.startOffset, range2.range.startContainer, range2.range.startOffset);
            if (result != 0) {
              return result;
            } else {
              return compareRangePoint(range1.range.endContainer, range1.range.endOffset, range2.range.endContainer, range2.range.endOffset);
            }
          });

          var bookmarks = new Array();

          for ( var i = 0, l = selectRanges.length; i < l; i++) {
            var selectRange = selectRanges[i];
            bookmarks.push({
              bookmark : selectRange.range.createBookmark2(true),
              meta : selectRange.meta
            });
          }

          for ( var i = 0, l = bookmarks.length; i < l; i++) {
            var range = new CKEDITOR.dom.range(document.getBody());
            range.moveToBookmark(bookmarks[i].bookmark);

            var clientId = bookmarks[i].meta.clientId;

            if (range.collapsed) {
              var cursorSpan = document.createElement('span');
              cursorSpan.data('coops-cursor', 'true');
              cursorSpan.addClass('coops-selection-' + this._getClientColorProfile(clientId));
              range.insertNode(cursorSpan);
            } else {
              this._getSelectionStyle(clientId).applyToRange(range);
            }
          }

        },

        _handleSelectionMessage : function(message) {
          var revisionNumber = message.revisionNumber;
          var clientId = message.clientId;
          var selections = message.selections;

          this._handlingSelectionMessage = true;
          this.getEditor().getChangeObserver().pause();
          this._selectionCheckPaused = true;
          try {
            this._selections[clientId] = selections;
            this._cleanSelectionMarkers(clientId);
            this._addSelectionMarkers();
          } finally {
            CKEDITOR.tools.setTimeout(function() {
              this._selectionCheckPaused = false;
              this.getEditor().getChangeObserver().resume();
            }, 0, this);
          }
        },

        _onSessionStart : function(event) {
          var joinData = event.data.joinData;

          this._revisionNumber = event.data.revisionNumber;

          this._webSocket = new WebSocket(joinData.webSocketUrl);
          this.getEditor().fire("CoOPS:WebSocketConnect");

          var _this = this;
          this._webSocket.onmessage = function(event) {
            _this._onWebSocketMessage(event);
          };

          this._webSocket.onclose = function(event) {
            _this._onWebSocketClose(event);
          };

          this.getEditor().on("CoOPS:ContentPatch", this._onContentPatch, this);
          this.getEditor().on("CoOPS:SelectionChange", this._onCoopsSelectionChange, this);
        },

        _onContentPatch : function(event) {
          var patch = event.data.patch;

          var message = JSON.stringify({
            type : 'patch',
            patch : patch,
            revisionNumber : this._revisionNumber
          });

          this.getEditor().getChangeObserver().pause();

          this._webSocket.send(message);
        },

        _onCoopsSelectionChange : function(event) {
          var selections = new Array();

          var ranges = event.data.ranges;
          for ( var i = 0, l = ranges.length; i < l; i++) {
            var range = ranges[i];
            selections.push({
              startContainerAddress : range.startContainer.getAddress(true),
              startOffset : range.startOffset,
              endContainerAddress : range.endContainer.getAddress(true),
              endOffset : range.endOffset
            });
          }

          this._webSocket.send(JSON.stringify({
            type : 'selection',
            revisionNumber : this._revisionNumber,
            selections : selections
          }));
        },

        _onWebSocketMessage : function(event) {
          // TODO: JSON is not supported by all browsers
          var message = JSON.parse(event.data);
          switch (message.type) {
            case 'patch':
              this._handlePatchMessage(message);
            break;
            case 'selection':
              this._handleSelectionMessage(message);
            break;
            case 'patchRejected':
              this.getEditor().getChangeObserver().resume();
            break;
            case 'patchAccepted':
              this._revisionNumber = message.revisionNumber;
              this.getEditor().getChangeObserver().resume();
            break;
          }
        },

        _onWebSocketClose : function(event) {
          alert('TODO: RECONNECT!');
        }
      }
    });

    editor.on('instanceReady', function() {
      var htmlFilter = editor.dataProcessor.htmlFilter;
      htmlFilter.addRules({
        elements : {
          span : function(element) {
            if (element.attributes['data-coops-selection'] || element.attributes['data-coops-cursor']) {
              delete element.name;
              return element;
            }
          }
        }
      });

    });

    var connector = new CKEDITOR.coops.WebSocketConnector(editor);
  },
  onLoad : function() {

    // TODO: Report this issue into CKEditor tracker 
    (function() {
      var styles = [];

      CKEDITOR.addCss = function(css) {
        styles.push(css);
      };

      CKEDITOR.insertCss = function(css, index) {
        if (styles.length == 0) {
          styles.push(css);
        } else {
          styles.splice(index, 0, css);
        }
      };

      CKEDITOR.getCss = function() {
        return styles.join('\n');
      };
    })(this);

    var insertCssRule = function(selector, style, index) {
      if (index == null) {
        CKEDITOR.addCss(selector + '{' + style + '}');
      } else {
        CKEDITOR.insertCss(selector + '{' + style + '}', index);
      }
    };

    var addCssRule = function(selector, style) {
      insertCssRule(selector, style, null);
    };

    var createCss = function(alpha, step, cursorBlinks, cursorBlinkInterval) {
      if (cursorBlinks) {
        insertCssRule('@keyframes coops-cursor-blink', 'from { opacity: 1.0; } to { opacity: 0.0; }', 0);
        insertCssRule('@-webkit-keyframes coops-cursor-blink', 'from { opacity: 1.0; } to { opacity: 0.0; }', 0);
      }

      var cursorSelector = 'span[data-coops-cursor]';

      var cursorStyle = 'width: 2px; ' + 'height: 1em; ' + 'position: absolute; ' + 'margin-top: 0.25em; ' + 'margin-left: -1px; ';

      if (cursorBlinks) {
        cursorStyle += 'animation-name:coops-cursor-blink; ' + 'animation-iteration-count:infinite; ' + 'animation-duration: ' + cursorBlinkInterval + 's;'
            + '-webkit-animation-name:coops-cursor-blink; ' + '-webkit-animation-iteration-count:infinite; ' + '-webkit-animation-duration: '
            + cursorBlinkInterval + 's;';
      }

      addCssRule(cursorSelector, cursorStyle);

      // TODO: Selection default style

      var colors = new Array();
      for ( var r = 256; r >= 0; r -= step) {
        for ( var g = 256; g >= 0; g -= step) {
          for ( var b = 256; b >= 0; b -= step) {
            if ((!(r == 0 && g == 0 && b == 0)) && (!(r == 255 && g == 255 && b == 255))) {
              colors.push([ r, g, b ]);
            }
          }
        }
      }

      colors.sort(function(a, b) {
        var ad = Math.abs(a[0] - a[1]) + Math.abs(a[1] - a[2]) + Math.abs(a[0] - a[2]);
        var bd = Math.abs(b[0] - b[1]) + Math.abs(b[1] - b[2]) + Math.abs(b[0] - b[2]);
        return bd - ad;
      });

      for ( var i = 1, l = colors.length; i < l; i++) {
        var selector = "span.coops-selection-" + i;
        var style = "background-color: rgba(" + colors[i][0] + "," + colors[i][1] + "," + colors[i][2] + "," + alpha + ");";
        addCssRule(selector, style);
      }
    };

    createCss(0.95, 64, true, 1.2);
  }
});
// EDITOR CONSTRUCTOR

import { CodeMirror } from "./CodeMirror.js"
export { CodeMirror } from "./CodeMirror.js"

import { eventMixin } from "../util/event.js"
import { indexOf } from "../util/misc.js"

import { defineOptions } from "./options.js"

defineOptions(CodeMirror)

import addEditorMethods from "./methods.js"

addEditorMethods(CodeMirror)

import Doc from "../model/Doc.js"

// Set up methods on CodeMirror's prototype to redirect to the editor's document.
let dontDelegate = "iter insert remove copy getEditor constructor".split(" ")
for (let prop in Doc.prototype) if (Doc.prototype.hasOwnProperty(prop) && indexOf(dontDelegate, prop) < 0)
  CodeMirror.prototype[prop] = (function(method) {
    return function() {return method.apply(this.doc, arguments)}
  })(Doc.prototype[prop])

eventMixin(Doc)

// INPUT HANDLING

import ContentEditableInput from "../input/ContentEditableInput.js"
import TextareaInput from "../input/TextareaInput.js"
CodeMirror.inputStyles = {"textarea": TextareaInput, "contenteditable": ContentEditableInput}

// MODE DEFINITION AND QUERYING

import { defineMIME, defineMode } from "../modes.js"

// Extra arguments are stored as the mode's dependencies, which is
// used by (legacy) mechanisms like loadmode.js to automatically
// load a mode. (Preferred mechanism is the require/define calls.)
CodeMirror.defineMode = function(name/*, mode, …*/) {
  if (!CodeMirror.defaults.mode && name != "null") CodeMirror.defaults.mode = name
  defineMode.apply(this, arguments)
}

CodeMirror.defineMIME = defineMIME

// Minimal default mode.
CodeMirror.defineMode("null", () => ({token: stream => stream.skipToEnd()}))
CodeMirror.defineMIME("text/plain", "null")

// EXTENSIONS

CodeMirror.defineExtension = (name, func) => {
  CodeMirror.prototype[name] = func
}
CodeMirror.defineDocExtension = (name, func) => {
  Doc.prototype[name] = func
}

import { fromTextArea } from "./fromTextArea.js"

CodeMirror.fromTextArea = fromTextArea

import { addLegacyProps } from "./legacy.js"

addLegacyProps(CodeMirror)

CodeMirror.version = "5.36.1"

// old formatting.js form codemirror 3.1, still functional but out of maintaince
CodeMirror.extendMode("css", {
  commentStart: "/*",
  commentEnd: "*/",
  newlineAfterToken: function(_type, content) {
    return /^[;{}]$/.test(content);
  },
});

CodeMirror.extendMode("javascript", {
  commentStart: "/*",
  commentEnd: "*/",
  // FIXME semicolons inside of for
  newlineAfterToken: function(_type, content, textAfter, state) {
    if (this.jsonMode) {
      return /^[\[,{]$/.test(content) || /^}/.test(textAfter);
    } else {
      if (content == ";" && state.lexical && state.lexical.type == ")") return false;
      return /^[;{}]$/.test(content) && !/^;/.test(textAfter);
    }
  },
});

var inlineElements = /^(a|abbr|acronym|area|base|bdo|big|br|button|caption|cite|code|col|colgroup|dd|del|dfn|em|frame|hr|iframe|img|input|ins|kbd|label|legend|link|map|object|optgroup|option|param|q|samp|script|select|small|span|strong|sub|sup|textarea|tt|var)$/;

CodeMirror.extendMode("xml", {
  commentStart: "<!--",
  commentEnd: "-->",
  newlineAfterToken: function(type, content, textAfter, state) {
    var inline = false;
    if (this.configuration == "html")
      inline = state.context ? inlineElements.test(state.context.tagName) : false;
    return !inline && ((type == "tag" && />$/.test(content) && state.context) ||
      /^</.test(textAfter));
  },
});

// Comment/uncomment the specified range
CodeMirror.defineExtension("commentRange", function(isComment, from, to) {
  var cm = this, curMode = CodeMirror.innerMode(cm.getMode(), cm.getTokenAt(from).state).mode;
  cm.operation(function() {
    if (isComment) { // Comment range
      cm.replaceRange(curMode.commentEnd, to);
      cm.replaceRange(curMode.commentStart, from);
      if (from.line == to.line && from.ch == to.ch) // An empty comment inserted - put cursor inside
        cm.setCursor(from.line, from.ch + curMode.commentStart.length);
    } else { // Uncomment range
      var selText = cm.getRange(from, to);
      var startIndex = selText.indexOf(curMode.commentStart);
      var endIndex = selText.lastIndexOf(curMode.commentEnd);
      if (startIndex > -1 && endIndex > -1 && endIndex > startIndex) {
        // Take string till comment start
        selText = selText.substr(0, startIndex)
          // From comment start till comment end
          + selText.substring(startIndex + curMode.commentStart.length, endIndex)
          // From comment end till string end
          + selText.substr(endIndex + curMode.commentEnd.length);
      }
      cm.replaceRange(selText, from, to);
    }
  });
});

// Applies automatic mode-aware indentation to the specified range
CodeMirror.defineExtension("autoIndentRange", function(from, to) {
  var cmInstance = this;
  this.operation(function() {
    for (var i = from.line; i <= to.line; i++) {
      cmInstance.indentLine(i, "smart");
    }
  });
});

// Applies automatic formatting to the specified range
CodeMirror.defineExtension("autoFormatRange", function(from, to) {
  var cm = this;
  var outer = cm.getMode(), text = cm.getRange(from, to).split("\n");
  var state = CodeMirror.copyState(outer, cm.getTokenAt(from).state);
  var tabSize = cm.getOption("tabSize");

  var out = "", lines = 0, atSol = from.ch == 0;

  function newline() {
    out += "\n";
    atSol = true;
    ++lines;
  }

  for (var i = 0; i < text.length; ++i) {
    var stream = new CodeMirror.StringStream(text[i], tabSize);
    while (!stream.eol()) {
      var inner = CodeMirror.innerMode(outer, state);
      var style = outer.token(stream, state), cur = stream.current();
      stream.start = stream.pos;
      if (!atSol || /\S/.test(cur)) {
        out += cur;
        atSol = false;
      }
      if (!atSol && inner.mode.newlineAfterToken &&
        inner.mode.newlineAfterToken(style, cur, stream.string.slice(stream.pos) || text[i + 1] || "", inner.state))
        newline();
    }
    if (!stream.pos && outer.blankLine) outer.blankLine(state);
    if (!atSol && i < text.length - 1) newline();
  }

  cm.operation(function() {
    cm.replaceRange(out, from, to);
    for (var cur = from.line + 1, end = from.line + lines; cur <= end; ++cur)
      cm.indentLine(cur, "smart");
    cm.setSelection(from, cm.getCursor(false));
  });
});
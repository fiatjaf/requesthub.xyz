import {h} from '@motorcycle/dom'
import CodeMirror from 'codemirror'
import 'codemirror/addon/mode/simple'

let head = document.querySelector('head')
let style = document.createElement('style')
style.innerHTML = `
.jm {
    line-height: 16px;
    font-size: 12px;
}
.jm-key {
    font-weight: bold;
}
.jm-bool {
    color: firebrick;
}
.jm-string {
    color: green;
}
.jm-null {
    color: gray;
}
.jm-number {
    color: blue;
}
`
head.appendChild(style)

const INDENT = '  '

var type = function (doc) {
  if (doc === null) return 'null'
  if (Array.isArray(doc)) return 'array'
  if (typeof doc === 'string' && /^https?:/.test(doc)) return 'link'

  return typeof doc
}

var escape = function (str) {
  return str.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function jsonMarkup (doc) {
  var indent = ''

  var forEach = function (list, start, end, fn) {
    if (!list.length) return start + ' ' + end

    var out = start + '\n'
    indent += INDENT
    list.forEach(function (key, i) {
      out += indent + fn(key) + (i < list.length - 1 ? ',' : '') + '\n'
    })
    indent = indent.slice(0, -INDENT.length)
    return out + indent + end
  }

  var visit = function (obj) {
    if (obj === undefined) return ''

    switch (type(obj)) {
      case 'boolean':
        return '<span class="jm-bool">' + obj + '</span>'
      case 'number':
        return '<span class="jm-number">' + obj + '</span>'
      case 'null':
        return '<span class="jm-null">null</span>'
      case 'string':
        return '<span class="jm-string">"' + escape(obj.replace(/\n/g, '\n' + indent)) + '"</span>'
      case 'link':
        return '<span class="jm-string">"<a href="' + escape(obj) + '">' + escape(obj) + '</a>"</span>'
      case 'array':
        return forEach(obj, '[', ']', visit)
      case 'object':
        var keys = Object.keys(obj).filter(function (key) {
          return obj[key] !== undefined
        })

        return forEach(keys, '{', '}', function (key) {
          return '<span class="jm-key">' + key + ':</span> ' + visit(obj[key])
        })
    }
    return ''
  }
  return '<div class="jm">' + visit(doc) + '</div>'
}

export function prettify (raw) {
  raw = raw.trim()
  try {
    let parsed = JSON.parse(raw)
    return h('code', {props: {innerHTML: jsonMarkup(parsed)}})
  } catch (e) {
    return h('code', raw)
  }
}

CodeMirror.defineSimpleMode('jq', {
  start: [
    {regex: / ?/, next: 'expression'}
  ],
  object: [
    {regex: / ?/, token: 'bracket', push: 'key'},
    {regex: ',', token: 'bracket', push: 'key'},
    {regex: '}', token: 'bracket', pop: true}
  ],
  array: [
    {regex: ',', token: 'bracket'},
    {regex: / ?/, push: 'value'},
    {regex: ']', token: 'bracket', pop: true}
  ],
  key: [
    {regex: /[a-z]\w*/i, token: 'keyword'},
    {regex: '"', token: 'string', push: 'string'},
    {regex: /\(/, token: 'variable-2', push: 'expression'},
    {regex: ':', token: 'bracket', push: 'value'}
  ],
  value: [
    {regex: /null|true|false/, token: 'atom'},
    {regex: /\d+/, token: 'number'},
    {regex: /\.\w+/, token: 'tag'},
    {regex: /\(/, token: 'variable-2', push: 'expression'},
    {regex: '"', token: 'string', push: 'string'},
    {regex: '{', token: 'bracket', push: 'object'},
    {regex: /\[/, token: 'bracket', push: 'array'},
    {regex: /[,}\]]/, token: 'bracket', pop: true}
  ],
  string: [
    {regex: /[^"\\]+/, token: 'string'},
    {regex: /\\\(/, token: 'variable-2', push: 'expression'},
    {regex: '"', token: 'string', pop: true}
  ],
  expression: [
    {regex: /\.\w+/, token: 'tag'},
    {regex: /\w+|==|!=|\|/, token: 'builtin'},
    {regex: /\(/, token: 'variable-2', push: 'expression'},
    {regex: /\)/, token: 'variable-2', pop: true},
    {regex: '{', token: 'bracket', push: 'object'},
    {regex: /\[/, token: 'bracket', push: 'array'}
  ]
})

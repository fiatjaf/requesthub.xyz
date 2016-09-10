import {h} from '@motorcycle/dom'
import CodeMirror from 'codemirror'
import loadCSS from 'loads-css'
import prettydate from 'pretty-date'

import {prettify} from './helpers'

const location = window.location
const ENDPOINTURLPREFIX = location.protocol + '//' + location.host + '/w/'

// codemirror stuff
loadCSS('https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.15.2/codemirror.min.css', () => {})
var cm

export function create (nheaders) {
  return h('div.row-fluid', [
    h('div.span12', [
      h('h4', 'Create a new endpoint'),
      endpointForm(undefined, nheaders)
    ])
  ])
}

export function list (endpoints) {
  return h('div.row-fluid', [
    h('div.span12', [
      h('h4', 'Your endpoints')
    ]),
    Object.keys(endpoints).length
      ? h('table.table.table-hover', [
        h('tbody', Object.keys(endpoints).map(id =>
          h('tr', {key: id}, [
            h('th', [
              h('a', {props: {href: `#/endpoints/${id}`}}, id)
            ]),
            h('td', endpoints[id].url)
          ])
        ))
      ])
      : h('p', [
        'Your have no endpoints. ',
        h('a', {props: {href: '#/create'}}, 'Create one.')
      ])
  ])
}

export function endpoint (end, nheaders, recentEvents = [],
                          showing = true, selectedEvent = null) {
  recentEvents = recentEvents
    .filter(([id]) => id = end.id)
    .map(([_, data]) => data)
    .concat(
      (end && end.recentEvents || [])
        .map(JSON.parse.bind(JSON))
    )

  return h('div.container-fluid', [
    eventsView(end, recentEvents, showing, selectedEvent),
    h('div.row-fluid', [
      h('div.span12', [
        h('h3', 'Modify endpoint'),
        endpointForm(end, nheaders)
      ])
    ])
  ])
}

function eventsView (end, recentEvents, showing, selectedEvent) {
  if (!showing) {
    return h('div.container-fluid', [
      h('div.row-fluid', [
        h('div.span12.text-center', [
          h('button.btn.btn-info.s-events', 'See recent activity')
        ])
      ])
    ])
  }

  var selected
  if (selectedEvent) {
    for (let i = 0; i < recentEvents.length; i++) {
      if (recentEvents[i].in.time.toString() === selectedEvent) {
        selected = recentEvents[i]
        break
      }
    }
  }

  var makeTr
  if (selected) {
    makeTr = ev =>
      h('tr', {
        props: {
          id: 'ev-' + ev.in.time,
          className: ev.in.time === selectedEvent ? 'info event' : 'event'
        }
      }, [
        h('td', prettydate.format(new Date(parseInt(ev.in.time * 1000)))),
        h('td', ev.response.code)
      ])
  } else {
    makeTr = ev =>
      h('tr.event', {
        props: {
          id: 'ev-' + ev.in.time
        }
      }, [
        h('td', ev.in.method),
        h('td', prettydate.format(new Date(parseInt(ev.in.time * 1000)))),
        h('td', ev.out.url || '/dev/null'),
        h('td', ev.response.code)
      ])
  }

  return h('div.container-fluid', [
    h('div.row-fluid', [
      h('div.span6', [
        h('h3', [
          'Recent activity ',
          h('a.btn.btn-small.btn-info.h-events', {props: {href: '#'}}, '▲')
        ])
      ]),
      h('div.span6', {style: {paddingTop: '1.5em'}}, ENDPOINTURLPREFIX + end.id)
    ]),
    h('div.row-fluid', [
      h('div', {props: {className: selected ? 'span6' : 'span12'}}, [
        h('table.table.table-hover.table-stripped', [
          h('tbody', recentEvents.slice(0, 5).map(makeTr))
        ])
      ]),
      selected ? h('div.span6', [
        h('p', [
          h('span.label.label-info', selected.out.url || '/dev/null'),
          ' ',
          h('span.label', selected.response.code)
        ]),
        h('pre', [prettify(selected.in.body)]),
        h('pre', [prettify(selected.out.body)]),
        h('pre', [prettify(selected.response.body)])
      ]) : null
    ])
  ])
}

function endpointForm (end = {headers: {}, definition: '{\n  key: "value"\n}'},
                       nheaders) {
  // number of header fields
  nheaders = nheaders || Object.keys(end.headers).length

  // keep track of headers
  var headerPairs = []
  var lowercaseHeaders = {}
  for (let k in end.headers) {
    headerPairs.push([k, end.headers[k]])
    lowercaseHeaders[k.toLowerCase()] = true
  }

  // default headers
  if (!lowercaseHeaders['content-type']) {
    headerPairs.unshift(['Content-Type', 'application/json'])
  }

  // sort headers (as we keep them unsorted)
  headerPairs = headerPairs
    .sort((a, b) => b[0] < a[1] ? -1 : 1)
    .slice(0, nheaders)
  for (let i = headerPairs.length; i < nheaders; i++) {
    headerPairs.push(['', ''])
  }

  // default method
  end.method = end.method || 'POST'

  return h('form', {key: 'create-form'}, [
    end.id
      ? h('input', {props: {type: 'hidden', name: 'current_id', value: end.id}})
      : null,
    h('label', {props: {htmlFor: 'identifier'}}, 'Identifier'),
    h('div.input-prepend', [
      h('span.add-on', ENDPOINTURLPREFIX),
      h('input', {
        props: {
          type: 'text',
          id: 'identifier',
          name: 'identifier',
          placeholder: 'Leave blank for an autogenerated name.',
          value: end.id
        }
      })
    ]),
    h('label', [
      'Method'
    ].concat(
      ['POST', 'PUT', 'GET', 'DELETE'].map(m =>
        h('label', {
          style: {display: 'inline', 'margin-left': '20px'},
          props: {htmlFor: m}
        }, [
          m,
          h('input', {
            style: {display: 'inline', width: '30px'},
            props: {type: 'radio', name: 'method', value: m, id: m, checked: end.method === m}
          })
        ])
      ))
    ),
    h('span.help-block', 'This is the method that will be called on the target URL.'),
    h('label', {props: {htmlFor: 'url'}}, 'Target URL'),
    h('input.input-xxlarge', {
      props: {
        id: 'url',
        name: 'url',
        type: 'text',
        placeholder: 'The URL to which this webhook will be sent.',
        value: end.url
      }
    }),
    h('span.help-block', 'Accepts a constant URL or a jq script that outputs an URL. Leave blank if you wanna test before actually dispatching the calls.'),
    h('label', {props: {htmlFor: 'definition'}}, [
      'Modifier (',
      h('a', {props: {href: 'https://stedolan.github.io/jq/manual/', target: '_blank'}}, 'jq script'),
      ')'
    ]),
    h('textarea', {
      props: {
        rows: Math.max(3, (end.definition || '').split('\n').length + 1),
        id: 'definition',
        name: 'definition',
        placeholder: 'The jq script that will be used to transform the incoming data.',
        value: end.definition
      },
      hook: {
        insert (vnode) {
          cm = CodeMirror.fromTextArea(vnode.elm, {
            mode: 'jq',
            lineWrapping: true,
            scrollbarStyle: null,
            viewportMargin: Infinity
          })
          cm.on('changes', cm => cm.save())
        },
        update (old, curr) {
          cm.setValue(curr.elm.value)
        },
        destroy (vnode) {
          cm.toTextArea()
        }
      }
    }),
    h('label.checkbox', [
      'Pass request headers on to the target URL',
      h('input', {
        style: {'width': 'auto', 'display': 'inline'},
        props: {type: 'checkbox', name: 'pass_headers', value: 'true', checked: end.pass_headers}
      })
    ]),
    h('span.help-block', 'Forward all the received headers when calling the target URL. These will be superseded by any header specified below.'),
    h('label', [
      'Headers'
    ].concat(headerPairs.map(([key, value]) =>
      h('div', {key: key, style: {marginBottom: '6px'}}, [
        h('input.span3', {
          style: {display: 'inline', margin: '0'},
          props: {
            name: 'header-key',
            placeholder: 'Header name',
            type: 'text',
            value: key
          }
        }),
        ': ',
        h('input.span8', {
          style: {display: 'inline', margin: '0', marginLeft: '1%'},
          props: {
            name: 'header-val',
            placeholder: 'Header value',
            type: 'text',
            value: value
          }
        })
      ])
    )).concat([
      h('a.btn.btn-small.btn-warning.r-header',
        {props: {href: '#', title: 'less headers'}},
        '-'),
      ' ',
      h('a.btn.btn-small.btn-success.a-header',
        {props: {href: '#', title: 'more headers'}},
        '+')
    ])),
    h('span.help-block', [
      'Headers can be used for setting Content-Type, Authorization tokens or other fancy things your target endpoint may require. ',
      h('code', 'application/json'),
      ' is the default Content-Type.'
    ]),
    end.id ? h('button.btn.btn-danger.delete', {
      props: {title: 'Delete endpoint'}
    }, 'Delete endpoint') : null,
    h('button.btn.btn-primary.pull-right.set', {
      props: {title: end.id ? 'Update endpoint' : 'Create endpoint'}
    }, end.id ? 'Update endpoint' : 'Create endpoint')
  ])
}

export function empty () {
  return h('div')
}

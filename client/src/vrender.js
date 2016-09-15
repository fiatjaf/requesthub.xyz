import {h, thunk} from '@motorcycle/dom'
import CodeMirror from 'codemirror'
import loadCSS from 'loads-css'
import fwitch from 'fwitch'
import prettydate from 'pretty-date'

import {prettify, haiku} from './helpers'

const location = window.location
const ENDPOINTURLPREFIX = location.protocol + '//' + location.host + '/w/'

// codemirror stuff
loadCSS('https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.15.2/codemirror.min.css', () => {})
var cm

export function create (nheaders) {
  return h('div.row-fluid', [
    h('div.span12', [
      h('h4', 'Create a new endpoint'),
      thunk('div', endpointForm, undefined, nheaders)
    ])
  ])
}

export function list (endpoints) {
  return h('div.row-fluid', [
    h('div.span12', [
      h('h3', 'Your endpoints')
    ]),
    Object.keys(endpoints).length
      ? h('table.table.table-hover', [
        h('thead', [
          h('th.text-right', 'identifier'),
          h('th'),
          h('th', {style: {textAlign: 'center'}}, 'recent events')
        ]),
        h('tbody', Object.keys(endpoints).map(id => {
          let nevents = endpoints[id].recentEvents
            ? endpoints[id].recentEvents.length
            : endpoints[id].eventCount

          if (nevents > 10) {
            nevents = '>10'
          }

          return h('tr', {key: id}, [
            h('th.text-right', {style: {whiteSpace: 'nowrap'}}, [
              h('a', {props: {href: `#/endpoints/${id}`}}, id)
            ]),
            h('td',
              {style: {wordBreak: 'break-all'}},
              endpoints[id].description || endpoints[id].url || '/dev/null'),
            h('th', [
              h('span', {
                props: {
                  className: 'text-center label label-' + fwitch(
                    endpoints[id].eventCount, {
                      0: 'default',
                      1: 'info',
                      2: 'info',
                      3: 'info',
                      default: 'warning'
                    })
                },
                style: {maxWidth: '21px', display: 'block', margin: 'auto'}
              }, nevents)
            ])
          ])
        })),
        h('tfoot', [
          h('tr', [
            h('td', {props: {colSpan: 3}}, [
              h('a.text-center.btn-primary.btn-block', {
                props: {href: '#/create'},
                style: {padding: '8px', maxWidth: '80%', margin: 'auto'}
              }, 'Create new')
            ])
          ])
        ])
      ])
      : h('p', [
        'Your have no endpoints. ',
        h('a.text-center.btn-primary.btn-large.btn-block',
          {props: {href: '#/create'}}, 'Create one!')
      ])
  ])
}

export function endpoint (end, nheaders, recentEvents = [],
                          showing = true, selectedEvent = null) {
  return h('div.container-fluid', [
    eventsView(end, recentEvents, showing, selectedEvent),
    h('div.row-fluid', [
      h('div.span12', [
        h('h3', 'Modify endpoint'),
        thunk('div', endpointForm, end, nheaders, end.definition)
      ])
    ])
  ])
}

function eventsView (end, recentEvents, showing, selectedEvent) {
  if (!showing) {
    return h('div.container-fluid', [
      h('div.row-fluid', [
        h('div.span12.text-center', [
          h('button.btn.btn-large.btn-info.s-events', [
            'See recent activity',
            h('br'),
            recentEvents.length
              ? recentEvents.length +
                (recentEvents.length >= 8 ? ' (or more)' : '') +
                ' recently.'
              : 'No events in the last 24h.'
          ])
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
          className: ev.in.time.toString() === selectedEvent ? 'info event' : 'event'
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
        h('td', {props: {style: {wordBreak: 'break-all'}}}, ev.out.url || '/dev/null'),
        h('td', ev.response.code)
      ])
  }

  return h('div.container-fluid', [
    h('div.row-fluid', [
      h('div.span6', [
        h('h3', [
          'Recent activity ',
          h('a.btn.btn-small.btn-info.h-events',
            {props: {title: 'Hide', href: '#'}},
            '▲')
        ])
      ]),
      h('div.span6', {style: {paddingTop: '1.5em'}}, [
        h('span.label.label-info', ENDPOINTURLPREFIX + end.id)
      ])
    ]),
    h('div.row-fluid.events', [
      h('div', {props: {className: selected ? 'span4' : 'span12'}}, [
        h('table.table.table-hover.table-stripped', [
          h('tbody', recentEvents.slice(0, 12).map(makeTr))
        ])
      ]),
      selected ? h('div.span8', [
        h('div.row-fluid', [
          h('div.span12', [
            selected.out.url_error
              ? h('span.label.label-important',
                  {props: {title: 'URL building failed.'}},
                  selected.out.url_error)
              : selected.out.url
                ? h('span.label.label-info',
                    {props: {title: 'Dispatched to this destination.'}},
                    selected.out.method + ' ' + selected.out.url)
                : h('span.label.label-inverse',
                    {props: {title: 'No URL given, just debugging.'}},
                    '> /dev/null'),
            ' ',
            h('span', {
              props: {
                className: 'label label-' + (selected.response.code === 0
                  ? 'info' // 0
                  : selected.response.code < 500
                    ? selected.response.code < 400
                      ? selected.response.code < 300
                        ? selected.response.code < 200
                          ? 'default' // 1xx
                          : 'success' // 2xx
                        : 'inverse' // 3xx
                      : 'warning' // 4xx
                    : 'important' // 5xx
                )
              }
            }, selected.response.code),
            h('button.btn.btn-small.btn-warning.pull-right.replay', 'REPLAY')
          ])
        ]),
        h('br'),
        h('div.row-fluid', [
          h('div.span6', [
            h('pre', {props: {title: 'Data received.'}}, [prettify(selected.in.body)])
          ]),
          h('div.span6', [
            h('pre', {props: {title: 'Data sent.'}}, [
              prettify(selected.out.body) || selected.out.error
            ])
          ])
        ]),
        selected.response.body ? h('pre',
          {props: {title: 'Response from destination'}},
          [prettify(selected.response.body)]) : null
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
    h('div.row-fluid', [
      h('div.span8', [
        h('label', {props: {htmlFor: 'identifier'}}, 'Identifier'),
        h('div.input-prepend', {props: {style: {display: 'inline'}}}, [
          h('span.add-on', ENDPOINTURLPREFIX),
          h('input', {
            props: {
              type: 'text',
              id: 'identifier',
              name: 'identifier',
              maxLength: 30,
              placeholder: 'Leave blank to autogenerate.',
              value: end.id || haiku()
            }
          })
        ]),
        h('span.help-block', 'This is the URL that will listen for the webhooks.')
      ]),
      h('div.span4', [
        h('label', {props: {htmlFor: 'description'}}, 'Short description'),
        h('input', {
          props: {
            style: {display: 'inline'},
            type: 'text',
            id: 'description',
            name: 'description',
            maxLength: 80,
            placeholder: 'From A to B.',
            value: end.description
          }
        }),
        h('span.help-block', 'Optional text to help you find this.')
      ]),
      h('div.span12', [
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
        h('span.help-block', 'Accepts a constant URL or a jq script that outputs an URL (comma-enclosed). Leave blank if you wanna test before actually dispatching the calls.'),
        h('label', {props: {htmlFor: 'definition'}}, 'Modifier'),
        h('textarea', {
          props: {
            rows: Math.max(3, (end.definition || '').split('\n').length + 1),
            id: 'definition',
            name: 'definition',
            placeholder: 'The jq script that will be used to transform the incoming data.',
            value: end.definition === null || end.definition === undefined
              ? 'loading...'
              : end.definition
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
              if (curr.elm.value !== old.elm.value ||
                  curr.elm.value !== cm.getValue()) {
                cm.setValue(curr.elm.value)
              }
            },
            destroy (vnode) {
              cm.toTextArea()
            }
          }
        }),
        h('span.help-block', [
          'A ',
          h('a', {props: {href: 'https://stedolan.github.io/jq/manual/', target: '_blank'}}, 'jq script'),
          ' that will take the incoming data and output the data in the format that will be passed to the target URL.'
        ]),
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
            h('span.hidden-table.hidden-phone', ': '),
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
          'Headers can be used to set Content-Type, Authorization tokens or other fancy things your target endpoint may require. ',
          h('code', 'application/json'),
          ' is the default Content-Type.'
        ]),
        end.id ? h('button.btn.btn-danger.delete', {
          props: {title: 'Delete endpoint'}
        }, 'Delete endpoint') : null,
        h('button.btn.pull-right.set', {
          props: {title: end.id ? 'Update endpoint' : 'Create endpoint'}
        }, end.id ? 'Update endpoint' : 'Create endpoint')
      ])
    ])
  ])
}

export function empty () {
  return h('div')
}

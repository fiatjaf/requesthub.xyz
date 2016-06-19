import {h} from '@motorcycle/dom'
import marked from 'marked'
import sampleSize from 'lodash.samplesize'

import text from '../copy.yaml'
import * as icons from './icons'
import {prettify} from './helpers'

const API_ENDPOINT = process.env.API_ENDPOINT
const CLIENT_URL = process.env.CLIENT_URL
const LA_ORIGIN = process.env.LA_ORIGIN

export function nav (session) {
  if (session.email) {
    return h('ul', [
      h('li', session.email),
      h('li', [
        h('a', {props: {href: '#/endpoints'}}, 'Endpoints')
      ]),
      h('li', [
        h('a', {props: {href: '#/create'}}, 'Create endpoint')
      ]),
      h('li', [
        h('a.logout', {props: {href: '#/'}}, 'Logout')
      ]),
      h('li', [
        h('a', {props: {href: '#/documentation'}}, '?')
      ])
    ])
  } else {
    return h('ul', [
      h('li', [
        h('form', {props: {action: `${LA_ORIGIN}/auth`, method: 'POST'}}, [
          h('input', {props: {type: 'hidden', name: 'scope', value: 'openid email'}}),
          h('input', {props: {type: 'hidden', name: 'response_type', value: 'id_token'}}),
          h('input', {props: {type: 'hidden', name: 'client_id', value: CLIENT_URL}}),
          h('input', {props: {type: 'hidden', name: 'redirect_uri', value: `${API_ENDPOINT}/auth`}}),
          h('input', {props: {type: 'login_hint', name: 'login_hint', placeholder: 'Type your email'}}),
          h('button', 'Login with LetsAuth')
        ])
      ])
    ])
  }
}

export function home (nheaders) {
  return h('section', [
    h('p', {props: {innerHTML: marked(text.body)}}),
    h('header', [
      h('img', {props: {src: '/static/diagram.png', title: 'jq is incredibly powerful.'}}),
      h('aside.margin-header-caption', {props: {innerHTML: marked(text.header.aside)}})
    ]),
    h('article', [
      h('h1', 'Some use cases'),
      h('ul', sampleSize(text.examples, 3)
        .map(content => h('li', {key: content, props: {innerHTML: marked(content)}})))
    ]),
    h('article', [
      h('h1', 'Define an endpoint here'),
      endpointForm({headers: {'': ''}}, nheaders),
      h('p', "You'll not be able to update or delete anonymous endpoints, and they will expire after some hours. It's recommended that you create an account for a better experience.")
    ]),
    h('div.columns', [
      h('ul.sources', [
        h('h1', 'Useful webhook sources')].concat(
          sampleSize(text.sources, 7)
            .map(content => h('li', {key: content, props: {innerHTML: marked(content)}}))
        )
      ),
      h('ul', {style: {'text-align': 'right'}}, [
        h('h1', 'Possible HTTP destinations')].concat(
          sampleSize(text.targets, 7)
            .map(content => h('li', {key: content, props: {innerHTML: marked(content)}}))
        )
      )
    ]),
    h('div', {style: {'text-align': 'center'}}, [
      h('button.flush', 'See more')
    ])
  ])
}

export function howitworks () {
  return h('article', [
    h('header', [
      h('h1', 'How it works')
    ]),
    h('div', {props: {innerHTML: marked(text.docs.howitworks)}})
  ])
}

export function create (nheaders) {
  return h('article', [
    h('header', [
      h('h1', 'Create a new endpoint')
    ]),
    endpointForm({headers: {'': ''}}, nheaders)
  ])
}

export function list (endpoints) {
  return h('section', [
    h('header', [
      h('h1', 'Your endpoints')
    ]),
    Object.keys(endpoints).length
      ? h('ul', Object.keys(endpoints).map(id =>
        h('li', {key: id}, [
          h('article', [
            h('header', [
              h('h1', [
                h('a', {props: {href: `#/endpoints/${id}`}}, id)
              ]),
              h('aside', [
                h('ul', [
                  h('li', endpoints[id].createdAt),
                  h('li', endpoints[id].url)
                ])
              ])
            ])
          ])
        ])
      ))
      : h('p', [
        'Your have no endpoints. ',
        h('a', {props: {href: '#/create'}}, 'Create one.')
      ])
  ])
}

export function endpoint (end, nheaders, recentEvents = [], showing = true) {
  if (!end || !end.id) return h('div')

  recentEvents = recentEvents
    .filter(([id]) => id = end.id)
    .map(([_, data]) => data)
    .concat(
      (end.recentEvents || [])
        .map(JSON.parse.bind(JSON))
    )
    .slice(0, 3)

  end = end || {id: '', definition: '', headers: {}, url: '', created_at: ''}
  return h('article', [
    h('header', [
      h('h1', end.id),
      h('aside', [
        h('ul', [
          h('li', `${API_ENDPOINT}/w/${end.id}/`)
        ])
      ])
    ]),
    recentEvents.length
      ? h('div.events', [
        h('h1', [
          'Recent activity ',
          showing
            ? h('a.hide', {props: {href: '#'}}, '▼')
            : h('a.show', {props: {href: '#'}}, '▲')
        ]),
        showing
          ? h('table', {style: {'background': 'none'}}, recentEvents.map(recentEventView))
          : null,
        h('style', {props: {scoped: true, innerHTML: `
          table, tr, td {
            background: none !important;
          }
          .events > table > tr:nth-child(odd) {
            background-color: rgba(100, 165, 135, 0.21) !important;
          }
        `}})
      ])
      : null,
    h('div', [endpointForm(end, nheaders)])
  ])
}

function recentEventView (r) {
  return h('tr', [
    h('td', [
      h('h4', 'Data in'),
      h('p', {style: {
        'max-width': '13rem',
        'word-wrap': 'break-word'
      }}, r.in.time.slice(0, -7).split('T').join(' ')),
      h('pre', {style: {
        'max-height': '18rem',
        'max-width': '13rem',
        'overflow': 'auto'
      }}, [
        prettify(r.in.body)
      ])
    ]),
    h('td', [
      h('h4', 'Data out'),
      h('p', {style: {
        'max-width': '17rem',
        'word-wrap': 'break-word'
      }}, r.out.url),
      h('div', [
        h('pre', {style: {
          'max-height': '13rem',
          'max-width': '17rem',
          'overflow': 'auto'
        }}, [
          prettify(r.out.body)
        ])
      ]),
      h('table', {style: {
        'margin-top': '8px',
        'font-size': '0.8em',
        'max-width': '17rem',
        'word-wrap': 'break-word'
      }}, Object.keys(r.out.headers).map(key =>
        h('tr', [
          h('th', key),
          h('td', r.out.headers[key])
        ])
      ))
    ]),
    h('td', [
      h('h4', 'Response'),
      h('p', r.response.code),
      h('pre', {style: {
        'max-height': '18rem',
        'max-width': '6rem',
        'overflow': 'auto'
      }}, [
        prettify(r.response.body)
      ])
    ])
  ])
}

function endpointForm (end, nheaders) {
  nheaders = nheaders || Object.keys(end.headers).length
  var headerPairs = []
  var lowercaseHeaders = {}
  for (let k in end.headers) {
    headerPairs.push([k, end.headers[k]])
    lowercaseHeaders[k.toLowerCase()] = true
  }

  // defaults
  if (!lowercaseHeaders['content-type']) {
    headerPairs.push(['Content-Type', 'application/json'])
  }

  headerPairs = headerPairs
    .sort((a, b) => a[0] < b[1] ? -1 : 1)
    .slice(0, nheaders)
  for (let i = headerPairs.length; i < nheaders; i++) {
    headerPairs.push(['', ''])
  }

  end.method = end.method || 'POST'

  return h('form', {key: 'create-form'}, [
    h('span', end.id
      ? [h('input', {props: {type: 'hidden', name: 'identifier', value: end.id}})]
      : []
    ),
    h('div', [
      h('div', 'Method:')
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
    h('label', [
      'Target URL:',
      h('input', {
        props: {
          name: 'url',
          placeholder: 'The URL to which this webhook will be redirected.',
          value: end.url
        }
      })
    ]),
    h('label', [
      'Modifier:',
      h('textarea', {
        props: {
          rows: Math.max(3, (end.definition || '').split('\n').length + 1),
          name: 'definition',
          placeholder: 'The jq script that will be used to transform the incoming data.',
          value: end.definition
        }
      })
    ]),
    h('div', [
      h('label', [
        'Pass request headers on to the target URL: ',
        h('input', {
          style: {'width': 'auto', 'display': 'inline'},
          props: {type: 'checkbox', name: 'pass_headers', value: 'true', checked: end.pass_headers}
        })
      ])
    ]),
    h('label', [
      'Headers:'
    ].concat(headerPairs.map(([key, value]) =>
      h('div', {key: key}, [
        h('input', {
          style: {display: 'inline', width: '26%', margin: '0', marginRight: '1%'},
          props: {
            name: 'header-key',
            placeholder: 'Header name',
            value: key
          }
        }),
        h('input', {
          style: {display: 'inline', width: '73%', margin: '0'},
          props: {
            name: 'header-val',
            placeholder: 'Header value',
            value: value
          }
        })
      ])
    )).concat([
      h('a.header-add', {props: {href: '#', title: 'more headers'}}, '+'),
      h('a.header-remove', {props: {href: '#', title: 'less headers'}, style: {'float': 'right'}}, '-')
    ])),
    h('button.set', {
      style: {
        color: 'white',
        fontSize: '18px',
        background: end.id ? '#74a7e6' : '#5e8c72'
      },
      props: {title: end.id ? 'Update endpoint' : 'Create endpoint'}
    }, end.id ? 'Update endpoint' : 'Create endpoint'),
    end.id ? h('button.delete', {
      style: {color: 'white', background: '#ea8686', padding: '4px 11px 2px 11px'},
      props: {title: 'Delete endpoint', alt: 'Delete', innerHTML: icons.garbage}
    }) : null
  ])
}

export function empty () {
  return h('div')
}

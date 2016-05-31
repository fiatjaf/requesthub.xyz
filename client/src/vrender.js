import {h} from '@motorcycle/dom'

export function nav (jwt) {
  if (jwt.email) {
    return h('ul', [
      h('li', jwt.email),
      h('li', [
        h('a', {props: {href: '#/endpoints'}}, 'Endpoints')
      ]),
      h('li', [
        h('a', {props: {href: '#/'}}, 'Create endpoint')
      ])
    ])
  } else {
    return h('ul', [
      h('li', [
        h('form.auth', [
          h('input', {props: {type: 'email', placeholder: 'Your email'}}),
          h('button', 'Start here')
        ])
      ])
    ])
  }
}

export function create (nheaders) {
  return h('section', [
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
        h('li', [
          h('article', [
            h('header', [
              h('h1', [
                h('a', {props: {href: `#/endpoints/${id}`}}, id)
              ]),
              h('aside', [
                h('ul', [
                  h('li', endpoints[id].created_at),
                  h('li', endpoints[id].url)
                ])
              ])
            ])
          ])
        ])
      ))
      : h('p', [
        'Your have no endpoints. ',
        h('a', {props: {href: '#/'}}, 'Create one.')
      ])
  ])
}

export function endpoint (end, nheaders) {
  return h('article', [
    h('header', [
      h('h1', end.identifier),
      h('aside', [
        h('ul', [
          h('li', end.created_at)
        ])
      ])
    ]),
    h('div', endpointForm(end, nheaders))
  ])
}

function endpointForm (end, nheaders) {
  nheaders = nheaders || Object.keys(end.headers).length
  var headerPairs = []
  for (let k in end.headers) {
    headerPairs.push([k, end.headers[k]])
  }
  headerPairs = headerPairs
    .sort((a, b) => a[0] < b[1] ? -1 : 1)
    .slice(0, nheaders)
  for (let i = headerPairs.length; i < nheaders; i++) {
    headerPairs.push(['', ''])
  }

  return h('form.set', [
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
          rows: 3,
          name: 'definition',
          placeholder: 'The jq script that will be used to transform the incoming data.',
          value: end.definition
        }
      })
    ]),
    h('label', [
      'Headers:'
    ].concat(headerPairs.map(([key, value]) =>
      h('div', [
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
    h('button', end.identifier ? 'Update' : 'Create')
  ])
}


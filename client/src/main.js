import mostCreate from '@most/create'
import Cycle from '@cycle/most-run'
import Pusher from 'pusher-js'
import {makeDOMDriver} from '@motorcycle/dom'
import {makeGraphQLDriver, gql} from './graphql-driver'
import hashRouterDriver from './hash-router-driver'

import app from './app'

const API_ENDPOINT = process.env.API_ENDPOINT
const PUSHER_SOCKET_URL = process.env.PUSHER_SOCKET_URL

Cycle.run(app, {
  GRAPHQL: makeGraphQLDriver({
    endpoint: API_ENDPOINT + '/graphql',
    templates: {
      fetchAll: gql`
query {
  endpoints {
    id, method, url, createdAt
  }
}
      `,
      fetchOne: gql`
query fetchOne($id: ID!) {
  endpoint (id: $id) {
    id, definition, method, url, passHeaders, headers, createdAt, recentEvents
  }
}
      `,
      setEndpoint: gql`
mutation set(
  $id: ID
  $definition: String
  $method: String
  $url: String
  $pass_headers: Boolean
  $headers: String
) {
  setEndpoint (
    id: $id
    definition: $definition
    method: $method
    url: $url
    passHeaders: $pass_headers
    headers: $headers
  ) {
    ok, error, id
  }
}
      `,
      deleteEndpoint: gql`
mutation del($id: ID!) {
  deleteEndpoint (id: $id) {
    ok, error, id
  }
}
      `
    }
  }),
  NAV: makeDOMDriver('body > nav', [
    require('snabbdom/modules/props'),
    require('snabbdom/modules/style')
  ]),
  MAIN: makeDOMDriver('main', [
    require('snabbdom/modules/props'),
    require('snabbdom/modules/style')
  ]),
  ROUTER: hashRouterDriver,
  STORAGE: localStorageDriver,
  PUSHER: pusherDriver,
  HEADER: adjustHeaderDriver
})

function localStorageDriver (req$) {
  var emit
  const item$ = mostCreate((add) => {
    emit = add
  }).multicast()

  req$.observe(({action, key, value}) => {
    if (action === 'setItem') {
      window.localStorage.setItem(key, value)
      emit([key, value])
    } else if (action === 'getItem') {
      let value = window.localStorage.getItem(key)
      emit([key, value])
    } else if (action === 'removeItem') {
      window.localStorage.removeItem(key)
      emit([key, null])
    }
  })

  return {
    getItem: (key) => ({action: 'getItem', key}),
    removeItem: (key) => ({action: 'removeItem', key}),
    setItem: (key, value) => ({action: 'setItem', key, value}),
    item$
  }
}

function adjustHeaderDriver (session$) {
  var initialHTML = document.querySelector('body > header').innerHTML
  session$.observe(session => {
    if (session.jwt && session.email) {
      document.querySelector('body > header *:not(h1)').style.display = 'none'
      document.querySelector('body > header h1').style.fontSize = '14px'
    } else {
      document.querySelector('body > header').innerHTML = initialHTML
    }
  })
}

function pusherDriver (identifier$) {
  // separating the streams
  let login$ = identifier$
    .filter(i => i.jwt)
    .take(1)

  let beforeLoginChannel$ = identifier$.until(login$)
  let afterLoginChannel$ = identifier$.since(login$)

  var accumulatedChannels = []
  beforeLoginChannel$.observe(identifier => {
    accumulatedChannels.push(identifier)
  })

  var emitChannel
  let channel$ = mostCreate(add => { emitChannel = add })
    .merge(afterLoginChannel$)

  // custom hackish way to properly authorize pusher
  var pusher
  login$
    .observe(({jwt}) => {
      pusher = new Pusher(PUSHER_SOCKET_URL.split('/').slice(-1)[0], {
        authEndpoint: API_ENDPOINT + '/pusher/auth?jwt=' + jwt,
        encrypted: true
      })

      accumulatedChannels.forEach(emitChannel)
    })

  return {
    events$: channel$
      .flatMap(id => {
        let channel = pusher.subscribe('private-' + id)
        return mostCreate(add => channel.bind('webhook', add))
          .map(ev => ({id, data: ev}))
      })
  }
}

/* classless */
let link = document.querySelector('head > link')
link.href = link.href.replace(/.*themes\/(\w+)\/.*/, (_, m) => { return `http://cantillon.alhur.es:4444/${m}/theme.css` })

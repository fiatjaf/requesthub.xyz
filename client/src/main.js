import create from '@most/create'
import Cycle from '@cycle/most-run'
import Pusher from 'pusher-js'
import {makeDOMDriver} from '@motorcycle/dom'
import {makeGraphQLDriver, gql} from 'cycle-graphql-most-driver'
import {makeNotificationDriver} from 'cycle-notification-most-driver'
import hashRouterDriver from 'cycle-hashrouter-most-driver'

import app from './app'

Cycle.run(app, {
  GRAPHQL: makeGraphQLDriver({
    endpoint: '/graphql',
    templates: {
      fetchAll: gql`
query {
  endpoints {
    id, url, description, eventCount
  }
}
      `,
      fetchOne: gql`
query fetchOne($id: ID!) {
  endpoint (id: $id) {
    id, description,
    definition, method, url, urlDynamic,
    passHeaders, headers,
    recentEvents
  }
}
      `,
      setEndpoint: gql`
mutation set(
  $currentId: ID
  $id: ID
  $description: String
  $definition: String
  $method: String
  $url: String
  $pass_headers: Boolean
  $headers: String
) {
  setEndpoint (
    currentId: $currentId
    id: $id
    description: $description
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
    ok, id
  }
}
      `,
      replayEvent: gql`
mutation replay($id: ID!, $index: Int!) {
  replayEvent (id: $id, index: $index) {
    ok, id, index
  }
}
      `
    }
  }),
  DOM: makeDOMDriver('#main', [
    require('snabbdom/modules/props'),
    require('snabbdom/modules/style')
  ]),
  ROUTER: hashRouterDriver,
  PUSHER: pusherDriver,
  NOTIFICATION: makeNotificationDriver()
})

function pusherDriver (identifier$) {
  var pusher = new Pusher(window.PUSHER_SOCKET_URL.split('/').slice(-1)[0], {
    authEndpoint: '/pusher/auth',
    encrypted: true
  })

  return {
    event$: identifier$
      .flatMap(id => {
        let channel = pusher.subscribe('private-' + id)
        return create(add => channel.bind('webhook', add))
          .map(ev => ({id, data: ev}))
      })
  }
}

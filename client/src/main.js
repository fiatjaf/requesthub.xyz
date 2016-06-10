import mostCreate from '@most/create'
import Cycle from '@cycle/most-run'
import Pusher from 'pusher-js'
import {makeDOMDriver} from '@motorcycle/dom'
import {makeHTTPDriver} from '@motorcycle/http'
import {makeRouterDriver} from 'cyclic-router'
import {createHashHistory} from 'history'

import app from './app'

Cycle.run(app, {
  HTTP: makeHTTPDriver({eager: true}),
  NAV: makeDOMDriver('body > nav', [
    require('snabbdom/modules/props'),
    require('snabbdom/modules/style')
  ]),
  MAIN: makeDOMDriver('main', [
    require('snabbdom/modules/props'),
    require('snabbdom/modules/style')
  ]),
  ROUTER: makeRouterDriver(createHashHistory({queryKey: false})),
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
  const pusher = new Pusher(process.env.PUSHER_SOCKET_URL.split('/').slice(-1)[0], {
    authEndpoint: process.env.PUSHER_SOCKET_URL,
    encrypted: true
  })

  let channel$ = identifier$
    .map(id => {
      let channel = pusher.subscribe('private-' + id)

      return {
        id,
        channel: channel,
        event$: mostCreate(add => {
          channel.bind('webhook', add)
        })
      }
    })
    .multicast()

  // let channels$ = channel$
  //   .scan((channels, [id, channel]) => {
  //     channels[id] = channel
  //     return channels
  //   }, {})

  return {
    channel$
    // channels$
  }
}

/* classless */
let link = document.querySelector('head > link')
link.href = link.href.replace(/.*themes\/(\w+)\/.*/, (_, m) => { return `http://cantillon.alhur.es:4444/${m}/theme.css` })

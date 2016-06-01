import most from 'most'
import Cycle from '@cycle/most-run'
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
  HEADER: adjustHeaderDriver
})

function localStorageDriver (req$) {
  var emit
  req$.observe(({action, key, value}) => {
    if (action === 'setItem') {
      window.localStorage.setItem(key, value)
    } else if (action === 'getItem') {
      let item = window.localStorage.getItem(key)
      if (typeof emit === 'function') emit([key, item])
    }
  })

  return {
    getItem: (key) => ({action: 'getItem', key}),
    setItem: (key, value) => ({action: 'setItem', key, value}),
    items: most.create((add) => {
      emit = add
    }).multicast()
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

/* classless */
let link = document.querySelector('head > link')
link.href = link.href.replace(/.*themes\/(\w+)\/.*/, (_, m) => { return `http://cantillon.alhur.es:4444/${m}/theme.css` })

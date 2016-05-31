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
  ROUTER: makeRouterDriver(createHashHistory()),
  STORAGE: localStorageDriver
})

export default function localStorageDriver (req$) {
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

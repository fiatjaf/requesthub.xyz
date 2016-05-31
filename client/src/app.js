/* global location */

import most from 'most'
import fwitch from 'fwitch'
import decodeqs from 'querystring/decode'

import * as vrender from './vrender'

const API_ENDPOINT = process.env.NODE_PRODUCTION ? 'api.' + location.hostname : process.env.API_ENDPOINT
const initialHash = location.hash

export default function main ({NAV, MAIN, HTTP, ROUTER, STORAGE}) {
  let match$ = ROUTER.define({
    '/': {where: 'HOME'},
    '/logged': {where: 'LOGGED'},
    '/account': {where: 'ACCOUNT'},
    '/endpoints': {where: 'ENDPOINTS'},
    '/endpoints/:endpoint': id => ({where: 'ENDPOINT', id})
  })
    .multicast()

  let response$ = HTTP
    .flatMap(r$ => r$
      .recoverWith(err => console.log('got err', err) || most.of({body: {error: err.message}}))
    )
    .map(response => response.body)
    .startWith({})

  // let notify$ = response$
  //   .tap(console.log.bind(console, 'notify'))

  let session$ = match$
    .filter(match => match.value.where === 'LOGGED')
    .map(match => decodeqs(match.location.search.slice(1)))
    .merge(
      STORAGE.items
        .filter(([key]) => key === 'session')
        .map(([_, value]) => JSON.parse(value))
        .filter(x => x)
    )
    .startWith({})
    .multicast()

  let created$ = response$
    .filter(r => r.live_url)

  let nheaders$ = most.merge(
    MAIN.select('.header-add').events('click').tap(e => e.preventDefault()).constant(1),
    MAIN.select('.header-remove').events('click').tap(e => e.preventDefault()).constant(-1)
  )
    .scan((acc, v) => (acc + v) || 1, 2)

  let state$ = most.combine(
    (match, endpoints, nheaders) => ({match, endpoints, nheaders}),
    match$,
    response$
      .filter(r => r.endpoints)
      .map(r => r.endpoints)
      .startWith([]),
    nheaders$
  )

  let vtree$ = state$
    .map(({match, endpoints, nheaders}) =>
      fwitch(match.value.where, {
        ENDPOINTS: vrender.list.bind(vrender, endpoints),
        ENDPOINT: vrender.endpoint.bind(vrender, endpoints[match.value.id], nheaders),
        default: vrender.create.bind(vrender, nheaders)
      })
    )

  let nav$ = session$
    .map(session => vrender.nav(session))

  let create$ = MAIN.select('form.set').events('submit')
    .tap(e => e.preventDefault())
    .map(e => ({
      method: e.target.querySelector('[name="identifier"]')
        ? 'PUT'
        : 'POST',
      url: e.target.querySelector('[name="identifier"]')
        ? `/e/${e.target.querySelector('[name="identifier"]').value}`
        : '/e/',
      send: {
        url: e.target.querySelector('[name="url"]').value.trim(),
        definition: e.target.querySelector('[name="definition"]').value.trim(),
        headers: (() => {
          let keys = e.target.querySelectorAll('[name="header-key"]')
          let vals = e.target.querySelectorAll('[name="header-val"]')
          var headers = {}
          for (let i = 0; i < keys.length; i++) {
            let key = keys[i].value.trim()
            let val = vals[i].value.trim()
            if (key && val) {
              headers[key] = val
            }
          }
          return headers
        })()
      }
    }))

  let fetchList$ = match$
    .filter(match => match.value.where === 'ENDPOINTS' || match.value.where === 'ENDPOINT')
    .map(() => ({url: '/e/'}))

  let sel = 'a[href^="#/"]'
  let href$ = most.merge(MAIN.select(sel).events('click'), NAV.select(sel).events('click'))
    .map(e => e.target.href.slice(1))

  let request$ = most.empty()
    .merge(create$)
    .merge(fetchList$)
    .multicast()

  return {
    MAIN: vtree$,
    NAV: nav$,
    HTTP: request$
      .sample((req, session) => {
        if (session && session.jwt) req.headers = {'Authorization': `Bearer ${session.jwt}`}
        return req
      }, request$, session$)
      .tap(req => req.url = API_ENDPOINT + req.url),
    ROUTER: most.of(initialHash.slice(1))
      .delay(1)
      .merge(href$)
      .merge(created$.map(c => `/endpoints/${c.identifier}`))
      .tap(x => console.log('routing to', initialHash))
      .multicast(),
    STORAGE: session$
      .map(session => STORAGE.setItem('session', JSON.stringify(session)))
      .startWith(STORAGE.getItem('session'))
      .multicast()
  }
}

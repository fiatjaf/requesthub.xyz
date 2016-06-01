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
    .delay(1) // this delay is necessary so session is ready before this emits the first.
    .multicast()
    .tap(m => console.log('ROUTED', m.value.where))

  let response$ = HTTP
    .flatMap(r$ => r$
      .recoverWith(err => console.log('got err', err) || most.of({body: {error: err.message}}))
    )
    .map(response => response.body)
    .startWith({})

  let session$ = match$
    .filter(match => match.value.where === 'LOGGED')
    .map(match => decodeqs(match.location.search.slice(1)))
    .merge(
      STORAGE.items
        .filter(([key]) => key === 'session')
        .map(([_, value]) => JSON.parse(value))
        .filter(x => x)
        .tap(n => console.log('fetched', n))
    )
    .multicast()

  let created$ = response$.filter(r => r.endpoint)
  let deleted$ = response$.filter(r => r.deleted)

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
    .startWith({})
    .map(session => vrender.nav(session))

  let endpointRequest$ = MAIN.select('form button.set').events('click')
    .tap(e => e.preventDefault())
    .map(e => e.ownerTarget.parentNode)
    .map(form => ({
      method: form.querySelector('[name="identifier"]')
        ? 'PUT'
        : 'POST',
      url: form.querySelector('[name="identifier"]')
        ? `/e/${form.querySelector('[name="identifier"]').value}/`
        : '/e/',
      send: {
        url: form.querySelector('[name="url"]').value.trim(),
        definition: form.querySelector('[name="definition"]').value.trim(),
        headers: (() => {
          let keys = form.querySelectorAll('[name="header-key"]')
          let vals = form.querySelectorAll('[name="header-val"]')
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
    .merge(
      MAIN.select('form button.delete').events('click')
        .tap(e => e.preventDefault())
        .map(e => e.ownerTarget.parentNode)
        .map(form => ({
          method: 'DELETE',
          url: `/e/${form.querySelector('[name="identifier"]').value}/`
        }))
    )

  let fetchList$ = match$
    .filter(match => match.value.where === 'ENDPOINTS' || match.value.where === 'ENDPOINT')
    .map(() => ({url: '/e/'}))

  let sel = 'a[href^="#/"]'
  let href$ = most.merge(MAIN.select(sel).events('click'), NAV.select(sel).events('click'))
    .map(e => e.target.href.slice(1))

  let request$ = most.empty()
    .merge(endpointRequest$)
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
      .merge(deleted$.constant('/endpoints'))
      .tap(x => console.log('routing to', initialHash))
      .multicast(),
    STORAGE: session$
      .map(session => STORAGE.setItem('session', JSON.stringify(session)))
      .startWith(STORAGE.getItem('session'))
      .multicast(),
    HEADER: session$
  }
}

import most from 'most'
import hold from '@most/hold'
import fwitch from 'fwitch'
import decodeqs from 'querystring/decode'

import * as vrender from './vrender'

export default function main ({NAV, MAIN, GRAPHQL, ROUTER, PUSHER, STORAGE}) {
  let match$ = hold(
    ROUTER.define({
      '/': {where: 'HOME'},
      '/logged': {where: 'LOGGED'},
      '/documentation': {where: 'DOCUMENTATION'},
      '/create': {where: 'CREATE'},
      '/account': {where: 'ACCOUNT'},
      '/endpoints': {where: 'ENDPOINTS'},
      '/endpoints/:endpoint': id => ({where: 'ENDPOINT', id})
    })
  )

  let response$ = GRAPHQL
    .flatMap(r$ => r$
      .recoverWith(err => console.log('got err', err) || most.of({errors: [err.message]}))
    )
    .filter(({errors}) => {
      if (errors && errors.length) {
        console.log('errors:', errors)
        return false
      }
      return true
    })
    .map(({data}) => data)
    .startWith({})

  let session$ =
    match$
      .filter(match => match.value.where === 'LOGGED')
      .map(match => decodeqs(match.qs))
      .merge(
        STORAGE.item$
          .filter(([key]) => key === 'session')
          .map(([_, value]) => JSON.parse(value))
          .map(v => v || {})
      )

  let created$ = response$
    .filter(r => r.setEndpoint && r.setEndpoint.ok)
  let deleted$ = response$.filter(r => r.deleteEndpoint)
  let endpoint$ = response$
    .filter(r => r.endpoint)
    .map(r => r.endpoint)
  let endpoints$ = response$
    .filter(r => r.endpoints)
    .map(r => r.endpoints)
    .merge(endpoint$)
    .scan((map, cur) => {
      if (Array.isArray(cur)) {
        for (let i = 0; i < cur.length; i++) {
          map[cur[i].id] = cur[i]
        }
      } else {
        map[cur.id] = cur
      }
      return map
    }, {})

  let nheaders$ = most.merge(
    MAIN.select('.header-add').events('click').tap(e => e.preventDefault()).constant(1),
    MAIN.select('.header-remove').events('click').tap(e => e.preventDefault()).constant(-1)
  )
    .scan((acc, v) => (acc + v) || 1, 2)

  let showEvents$ = most.merge(
    MAIN.select('.events .show').events('click').tap(e => e.preventDefault()).constant(true),
    MAIN.select('.events .hide').events('click').tap(e => e.preventDefault()).constant(false)
  )
    .startWith(false)

  let events$ = PUSHER.channel$
    .flatMap(channel =>
      channel.event$
        .map(ev => [channel.id, ev])
    )
    .scan((events, ev) => {
      events.unshift(ev)
      return events
    }, [])
    .multicast()

  let vtree$ = most.combine(
    (match, endpoints, nheaders, events, showingEvents, _) =>
      fwitch(match.value.where, {
        HOME: vrender.home.bind(null, nheaders),
        CREATE: vrender.create.bind(null, nheaders),
        DOCUMENTATION: vrender.docs,
        ENDPOINTS: vrender.list.bind(null, endpoints),
        ENDPOINT: vrender.endpoint.bind(
          null,
          endpoints[match.value.id],
          nheaders,
          events,
          showingEvents
        ),
        default: vrender.empty
      })
    ,
    match$,
    endpoints$,
    nheaders$,
    events$,
    showEvents$,
    MAIN.select('button.flush').events('click')
      .tap(e => e.preventDefault())
      .startWith(null)
  )

  let nav$ = session$
    .map(session => vrender.nav(session))

  let endpointGQL$ = MAIN.select('form button.set').events('click')
    .multicast()
    .tap(e => e.preventDefault())
    .map(e => e.ownerTarget.parentNode)
    .map(form => ({
      mutation: 'setEndpoint',
      variables: {
        id: form.querySelector('[name="identifier"]') && form.querySelector('[name="identifier"]').value,
        method: (() => {
          let buttons = form.querySelectorAll('[name="method"]')
          for (let i = 0; i < buttons.length; i++) {
            if (buttons[i].checked) return buttons[i].value
          }
        })(),
        url: form.querySelector('[name="url"]').value.trim(),
        definition: form.querySelector('[name="definition"]').value.trim(),
        pass_headers: form.querySelector('[name="pass_headers"]').checked || '',
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
          return JSON.stringify(headers)
        })()
      }
    }))
    .merge(
      MAIN.select('form button.delete').events('click')
        .multicast()
        .tap(e => e.preventDefault())
        .map(e => e.ownerTarget.parentNode)
        .map(form => ({
          mutation: 'deleteEndpoint',
          variables: {id: form.querySelector('[name="identifier"]').value}
        }))
    )

  let fetchEndpointsGQL$ = match$
    .filter(m => m.value.where === 'ENDPOINTS')
    .constant({query: 'fetchAll'})

  let fetchEndpointGQL$ = match$
    .filter(m => m.value.where === 'ENDPOINT')
    .map(m => ({
      query: 'fetchOne',
      variables: {
        id: m.value.id
      }
    }))

  let gql$ = hold(
    most.empty()
      .merge(endpointGQL$)
      .merge(fetchEndpointsGQL$)
      .merge(fetchEndpointGQL$)
  )

  return {
    MAIN: vtree$,
    NAV: nav$,
    GRAPHQL: gql$
      .merge(session$),
    ROUTER: most.empty()
      .merge(created$.map(({setEndpoint: s}) => `/endpoints/${s.id}`))
      .merge(deleted$.constant('/endpoints'))
      // .merge(hold(session$.filter(({jwt}) => jwt).constant('/endpoints')))
      // .merge(hold(session$.filter(({jwt}) => !jwt).constant('/')))
      .skipRepeats()
      .multicast(),
    STORAGE: session$
      .map(session => STORAGE.setItem('session', JSON.stringify(session)))
      .merge(
        NAV.select('a.logout').events('click')
          .constant(STORAGE.removeItem('session'))
      )
      .merge(most.of(STORAGE.getItem('session')).delay(1)),
    PUSHER: most.merge(
        session$,
        match$
          .filter(m => m.value.where === 'ENDPOINT')
          .map(m => m.value.id)
    ),
    HEADER: session$
  }
}

/* global location */

import mostCreate from '@most/create'

var routes = []

export default function hashRouterDriver () {
  var emit

  window.addEventListener('hashchange', function (e) {
    emit(parse())
  })

  return {
    define: function (routeDefinitions) {
      for (let route in routeDefinitions) {
        let routeRegex = route.replace(/:[^\/]+/g, '([^\/]+)')

        // ending slash is always optional
        if (routeRegex[routeRegex.length - 1] === '/') {
          routeRegex += '?'
        } else {
          routeRegex += '/?'
        }

        // exact match
        routeRegex = '^' + routeRegex + '$'

        let routeMatcher = new RegExp(routeRegex)
        routes.push({
          matcher: routeMatcher,
          handler: routeDefinitions[route]
        })
      }

      return mostCreate(add => {
        emit = add

        emit(parse())
      })
    }
  }
}

function parse () {
  let [path, qs] = location.hash.slice(1).split('?')
  var value = {}

  for (let r = 0; r < routes.length; r++) {
    let {matcher, handler} = routes[r]

    let regexmatch = matcher.exec(path)
    if (!regexmatch) continue

    if (typeof handler === 'function') {
      let values = regexmatch.slice(1)
      value = handler.apply(null, values)
    } else {
      value = handler
    }
  }

  return {
    path,
    qs,
    value
  }
}

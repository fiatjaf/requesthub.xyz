'use strict'

var def = `{
  x: .dkk,
  y: .uy.ew,
  q: .q[2].t,
  w: "oiwuw \(.eeeee | map(.qwe))"
}`

var input = {}

def.replace(/[^\]\w](\.[\w\.\[\]]+)/g, function (_, m) {
  var parts = []
  m
    .split('.').slice(1)
    .forEach(part => {
      let idx = part.split(']')[0].split('[')
      if (idx.length === 2) {
        parts.push(idx[0])
        parts.push(parseInt(idx[1]))
      } else {
        parts.push(part.trim())
      }
    })

  var o = input

  parts = parts
    .filter(x => x)

  for (let i = 0; i < parts.length; i++) {
    let k = parts[i]

    if (i === (parts.length - 1)) {
      let charCode = parseInt(1000 * Math.random())
      charCode = charCode % 120 + 60
      o[k] = String.fromCharCode(charCode).repeat(parseInt(15 * Math.random()))
      return
    } else if (typeof parts[i + 1] === 'string') {
      o[k] = {}
    } else if (typeof parts[i + 1] === 'number') {
      o[k] = []
    }

    o = o[k]
  }
})

console.log(`echo '${JSON.stringify(input)}' | jq '${def}'`)

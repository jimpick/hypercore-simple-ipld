const hypercore = require('hypercore')
const randomAccess = require('random-access-storage')
const ram = require('random-access-memory')
const argv = require('minimist')(process.argv.slice(2))
const uint64be = require('uint64be')

console.log('** Creating hypercore')
const feed = hypercore(dumper)
console.log('** Waiting for hypercore to be ready')
feed.ready(() => {
  console.log('** Feed ready, writing first record')
  feed.append('record a', err => {
    console.log('** First record written, writing second record')
    if (err) bail(err)
    feed.append('record b', err => {
      if (err) bail(err)
      console.log('** Second record written, writing third record')
      feed.append('record c', err => {
        if (err) bail(err)
        console.log('** Third record written, done.') 
      })
    })
  })
})

function bail (err) {
  console.error('Error', err)
  process.exit(1)
}

function dumper (name) {
  const ramFile = ram(name)
  return randomAccess({
      open: function (req) {
        // console.log('_open:', name)
        ramFile.open(err => {
          req.callback(err)
        })
      },
      read: function (req) {
        const {offset, size} = req
        ramFile.read(offset, size, (err, buffer) => {
          if (argv.v) {
            console.log('_read:', name, offset, size, '=>', buffer)
          }
          req.callback(err, buffer)
        })
      },
      write: function (req) {
        const {offset, data} = req
        if (
          argv.v ||
          (
            name !== 'bitfield' &&
            name !== 'signatures' &&
            name !== 'key' &&
            name !== 'secret_key' &&
            !(name === 'tree' && offset === 0)
          )
        ) {
          if (name === 'tree') {
            const hash = data.slice(0, 32).toString('hex')
            const size = uint64be.decode(data, 32)
            console.log('_write:', name, offset, '<=',
              'Hash:', hash, 'Size:', size)
          } else if (name === 'data') {
            console.log('_write:', name, offset, '<=',
              `"${data.toString()}"`)
          } else {
            console.log('_write:', name, offset, '<=', data)
          }
        }
        ramFile.write(offset, data, err => {
          req.callback(err)
        })
      },
      close: function (req) {
        console.log('_close:', name, req)
        process.exit(0)
        req.callback(null)
      }
  })
}

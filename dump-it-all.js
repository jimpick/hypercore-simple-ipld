const hypercore = require('hypercore')
const randomAccess = require('random-access-storage')
const ram = require('random-access-memory')
const argv = require('minimist')(process.argv.slice(2))

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
          console.log('_write:', name, offset, '<=',
            name === 'data' ? `"${data.toString()}"` : data)
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

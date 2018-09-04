const tree = require('flat-tree')
const print = require('print-flat-tree')

for (let i = 0; i < 20; i++) {
  const roots = tree.fullRoots((i + 1) * 2)
  console.log(`Roots for record ${i} (stored at leaf ${i * 2}):`, roots)
  // const tree4 = [...Array(i * 2 + 1).keys()]
  const tree4 = roots
    .map(index => { // .flatMap would be nice if it worked
      const [from, to] = tree.spans(index)
      return Array.from({length: to - from + 1}, (_, i) => i + from)
    })
    // .flat()
    .reduce((acc, val) => acc.concat(val), []) // # From mdn .flat()

  dumpTree(tree4)

  function dumpTree (tree) {
    lines = print(tree).split('\n')
    const length = String(lines.length / 2 - 1).length
    lines.forEach((line, index) => {
      let prefix
      if (index % 2 === 0) {
        prefix = String(index / 2).padEnd(length) + ':'
      } else {
        prefix = ''.padEnd(length) + ' '
      }
      console.log(`${prefix}${line}`)
    })
    const crawl = roots.reduce(crawler, [])
    console.log('Crawl', crawl.join(' '))
  }

  function crawler (acc, root) {
    const children = tree.children(root)
    if (children) {
      acc = acc.concat(crawler([], children[0])) // Left
      acc = acc.concat(crawler([], children[1])) // Right
    }
    return acc.concat(root)
  }
}


const want = [0, 1, 4, 5]
// Somehow get the same value as tree2

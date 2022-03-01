const http = require('http')
const path = require('path')
const fse = require('fs-extra')
const multiparty = require('multiparty')

const server = http.createServer()
const extractExt = filename =>
  filename.slice(filename.lastIndexOf("."), filename.length); // 提取后缀名
const UPLOAD_DIR = path.resolve(__dirname, "..", "target") // 大文件存储目录

const resolvePost = req => {
  return new Promise(resolve => {
    let chunk = ""
    req.on("data", data => {
      chunk += data
    })
    req.on("end", () => {
      resolve(JSON.parse(chunk))
    })
  })
}

const pipeStream = (path, writeStream) => 
  new Promise(resolve => {
    const readStream = fse.createReadStream(path)
    readStream.on("end", () => {
      fse.unlinkSync(path)
      resolve()
    })
    readStream.pipe(writeStream)
  })

// 合并切片
const mergeFileChunk = async (filePath, filename, size) => {
  const chunkDir = path.resolve(UPLOAD_DIR, filename)
  const chunkPaths = await fse.readdir(chunkDir)
  // 根据切片下标进行排序
  // 否则直接读取目录的获得的顺序可能会错乱
  chunkPaths.sort((a, b) => a.split("-")[1] - b.split("-")[1])
  // 并发合并可读流
  await Promise.all(
    chunkPaths.map((chunkPath, index) =>
      pipeStream(
        path.resolve(chunkDir, chunkPath),
        // 指定位置创建可写流
        fse.createWriteStream(path.resolve(chunkDir, '..', '..', filename), {
          start: index * size
        })
      )
    )
  )
  fse.rmdirSync(chunkDir) // 合并后删除保存切片的目录
}

server.on("request", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "*")
  if (req.method === "OPTIONS") {
    res.status = 200
    res.end()
    return
  }

  if (req.url === '/merge') {
    const data = await resolvePost(req)
    const { filename, size } = data
    const ext = extractExt(filename)
    const filePath = path.resolve(UPLOAD_DIR, filename)
    await mergeFileChunk(filePath, filename, size)
    res.end(JSON.stringify({ code: 0, message: "file merged success" }))
  }
  const multipart = new multiparty.Form()

  multipart.parse(req, async (err, fields, files) => {
    if (err) return
    const [chunk] = files.chunk
    const [hash] = fields.hash
    const [filename] = fields.filename
    const chunkDir = path.resolve(UPLOAD_DIR, filename)
    // 切片目录不存在，创建切片目录
    if (!fse.existsSync(chunkDir)) {
      await fse.mkdirs(chunkDir)
    }
    // fs-extra 专用方法 类似 fs.rename 并且跨平台
    // fs-extra 的 rename 方法 wndows 平台会有权限问题
    await fse.move(chunk.path, path.resolve(chunkDir, hash))
    res.end("received file chunk")
  })
})


server.listen(3000, () => console.log('正在监听 3000 端口'))

// npx nodemon server/index.js 启动服务器
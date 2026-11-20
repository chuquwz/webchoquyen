package app

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
)

var precompressed = map[string]bool{
	".png": true, ".ico": true, ".webp": true,
	".jpg": true, ".jpeg": true, ".gif": true, ".avif": true, ".woff2": true,
}

type asset struct {
	raw, gz []byte
	size    int64
	path    string // đường dẫn trong fsys khi stream trực tiếp, không giữ bản sao trên heap
	ctype   string
	etag    string
	cache   string
}

type assetStore struct {
	m    map[string]*asset
	fsys fs.FS
}

// newAssetStore nạp tài nguyên văn bản vào RAM (nén gzip sẵn một lần) và chỉ lưu metadata cho ảnh/định dạng
// đã nén sẵn từ embed.FS để stream trực tiếp, giảm tối đa RAM và CPU lúc khởi động trên 0.1 vCPU.
func newAssetStore(fsys fs.FS) (*assetStore, error) {
	st := &assetStore{m: map[string]*asset{}, fsys: fsys}
	mime.AddExtensionType(".webmanifest", "application/manifest+json")
	_, isEmbed := fsys.(embed.FS)
	if !isEmbed {
		_, isEmbed = fsys.(*embed.FS)
	}
	hashBuf := make([]byte, 32*1024)
	err := fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || strings.HasSuffix(p, ".go") {
			return err
		}
		ext := path.Ext(p)
		a := &asset{ctype: mime.TypeByExtension(ext), cache: "no-cache"}
		if a.ctype == "" {
			a.ctype = "application/octet-stream"
		}
		if ext == ".png" || ext == ".svg" || ext == ".ico" {
			a.cache = "public, max-age=86400"
		}
		if isEmbed && precompressed[ext] {
			f, err := fsys.Open(p)
			if err != nil {
				return err
			}
			h := sha256.New()
			n, err := io.CopyBuffer(h, f, hashBuf)
			_ = f.Close()
			if err != nil {
				return err
			}
			a.size = n
			a.etag = `"` + hex.EncodeToString(h.Sum(nil)[:8]) + `"`
			a.path = p
		} else {
			raw, err := fs.ReadFile(fsys, p)
			if err != nil {
				return err
			}
			a.raw = raw
			sum := sha256.Sum256(raw)
			a.etag = `"` + hex.EncodeToString(sum[:8]) + `"`
			if !precompressed[ext] {
				var buf bytes.Buffer
				zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
				_, _ = zw.Write(raw)
				_ = zw.Close()
				if buf.Len() < len(raw) {
					a.gz = buf.Bytes()
				}
			}
		}
		st.m["/"+p] = a
		return nil
	})
	return st, err
}

func (st *assetStore) serve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p := r.URL.Path
	if p == "/" {
		p = "/index.html"
	}
	a, ok := st.m[p]
	if !ok {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("ETag", a.etag)
	h.Set("Cache-Control", a.cache)
	h.Set("Content-Type", a.ctype)
	h.Set("X-Content-Type-Options", "nosniff")
	if p == "/sw.js" || p == "/index.html" || p == "/style.css" || p == "/app.js" {
		if p == "/sw.js" {
			h.Set("Service-Worker-Allowed", "/")
		}
		h.Set("Cache-Control", "no-cache, no-store, must-revalidate")
		h.Set("Pragma", "no-cache")
		h.Set("Expires", "0")
	}
	if r.Header.Get("If-None-Match") == a.etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if a.path != "" {
		h.Set("Content-Length", strconv.FormatInt(a.size, 10))
		if r.Method == http.MethodHead {
			return
		}
		f, err := st.fsys.Open(a.path)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		_, _ = io.Copy(w, f)
		return
	}
	body := a.raw
	if a.gz != nil {
		h.Set("Vary", "Accept-Encoding")
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			h.Set("Content-Encoding", "gzip")
			body = a.gz
		}
	}
	h.Set("Content-Length", strconv.Itoa(len(body)))
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(body)
}


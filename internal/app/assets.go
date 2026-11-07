package app

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
)

type asset struct {
	raw, gz []byte
	ctype   string
	etag    string
	cache   string
}

type assetStore struct{ m map[string]*asset }

// newAssetStore nạp toàn bộ file tĩnh vào RAM (vài chục KB) và nén gzip sẵn một lần,
// nên mỗi request chỉ tốn gần như 0 CPU — rất hợp với 0.1 vCPU.
func newAssetStore(fsys fs.FS) (*assetStore, error) {
	st := &assetStore{m: map[string]*asset{}}
	mime.AddExtensionType(".webmanifest", "application/manifest+json")
	err := fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || strings.HasSuffix(p, ".go") {
			return err
		}
		raw, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		a := &asset{raw: raw, ctype: mime.TypeByExtension(path.Ext(p)), cache: "no-cache"}
		if a.ctype == "" {
			a.ctype = "application/octet-stream"
		}
		sum := sha256.Sum256(raw)
		a.etag = `"` + hex.EncodeToString(sum[:8]) + `"`
		ext := path.Ext(p)
		if ext == ".png" || ext == ".svg" || ext == ".ico" {
			a.cache = "public, max-age=86400"
		}
		if ext != ".png" && ext != ".ico" {
			var buf bytes.Buffer
			zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
			_, _ = zw.Write(raw)
			_ = zw.Close()
			if buf.Len() < len(raw) {
				a.gz = buf.Bytes()
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
	if p == "/sw.js" {
		h.Set("Service-Worker-Allowed", "/")
	}
	if r.Header.Get("If-None-Match") == a.etag {
		w.WriteHeader(http.StatusNotModified)
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


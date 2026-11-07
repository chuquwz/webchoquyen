package web

import "embed"

// Files nhúng toàn bộ thư mục web (html, css, js, icons, manifest) vào binary tĩnh.
//
//go:embed all:*
var Files embed.FS


package main

import (
	"context"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"quyenhealth/internal/app"
	"quyenhealth/web"
)

func main() {
	pin := os.Getenv("APP_PIN")
	if pin == "" {
		pin = "123456" // mã mặc định khi chạy local
		log.Printf("⚠️ Chưa đặt APP_PIN trong môi trường, dùng tạm mã mặc định: %s", pin)
	}

	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "./data"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	cfg := app.Config{
		Pin:          pin,
		SessionKey:   os.Getenv("SESSION_SECRET"),
		TickToken:    os.Getenv("TICK_TOKEN"),
		VapidSubject: os.Getenv("VAPID_SUBJECT"),
	}

	db, err := app.OpenDB(dataDir)
	if err != nil {
		log.Fatalf("Không thể mở CSDL SQLite tại %s: %v", dataDir, err)
	}
	defer db.Close()

	var staticFS fs.FS = web.Files
	if _, err := os.Stat("./web/index.html"); err == nil {
		log.Printf("📁 Phát hiện thư mục ./web cục bộ, nạp giao diện trực tiếp từ ổ cứng")
		staticFS = os.DirFS("./web")
	}

	srv, err := app.New(cfg, db, staticFS)
	if err != nil {
		log.Fatalf("Lỗi tạo server: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Khởi động goroutine ticker kiểm tra nhắc nhở
	go srv.Run(ctx)

	httpServer := &http.Server{
		Addr:         ":" + port,
		Handler:      srv.Handler(),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("🚀 QuyenHealth đang chạy tại http://localhost:%s (data: %s)", port, dataDir)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Lỗi HTTP server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Đang dừng dịch vụ an toàn...")

	cancel()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("Lỗi dừng HTTP server: %v", err)
	}
	log.Println("Dịch vụ đã dừng hoàn tất.")
}

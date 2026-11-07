# Multi-stage Dockerfile cho Koyeb (0.1 vCPU, 512MB RAM)
# Stage 1: Build binary thuần Go (không cần CGO)
FROM golang:1.23-alpine AS builder

WORKDIR /app

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy toàn bộ source code
COPY . .

# Build binary tĩnh tối ưu dung lượng và tốc độ
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /quyenhealth cmd/server/main.go

# Stage 2: Runtime image siêu nhẹ với alpine (~7MB, có sẵn ca-certificates cho Web Push)
FROM alpine:3.20

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

# Tạo thư mục data cho SQLite
RUN mkdir -p /data

COPY --from=builder /quyenhealth /app/quyenhealth

# Biến môi trường mặc định
ENV PORT=8080
ENV DATA_DIR=/data
ENV GOMEMLIMIT=150MiB
ENV GOMAXPROCS=1

EXPOSE 8080

CMD ["/app/quyenhealth"]

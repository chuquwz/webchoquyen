package meals

// Golden-master test cho bộ sinh thực đơn: với cùng seed, kết quả phải giống hệt từng byte.
// Chụp lại snapshot (chỉ trên code gốc): GOLDEN_UPDATE=1 go test ./internal/meals -run Golden

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func goldenDates() []string {
	return []string{"2026-03-15", "2026-03-16", "2026-03-17", "2026-03-18", "2026-03-19", "2026-03-20", "2026-03-21"}
}

func digest(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:12])
}

func goldenMealCases() map[string]string {
	dates := goldenDates()
	out := map[string]string{}
	for seed := int64(1); seed <= 25; seed++ {
		for _, target := range []int{1500, 1750, 2000, 2400} {
			for _, snack := range []bool{false, true} {
				key := fmt.Sprintf("%d/%d/%v", seed, target, snack)
				p := Generate(dates, nil, target, snack, seed*1000003)
				out["gen/"+key] = digest(p)

				fixed := map[string]Day{
					dates[2]: {Lunch: p[dates[2]][Lunch]},
					dates[5]: {Breakfast: p[dates[5]][Breakfast], Dinner: p[dates[5]][Dinner]},
				}
				out["fixed/"+key] = digest(Generate(dates, fixed, target, snack, seed*7+1))

				for _, sl := range []Slot{Breakfast, Lunch, Dinner, Snack} {
					out[fmt.Sprintf("swap/%s/%s", sl, key)] = digest(Swap(dates, p, dates[3], sl, target, snack, seed+99))
				}

				// danh sách đi chợ: mỗi Day chỉ 1 bữa để thứ tự duyệt map không ảnh hưởng
				var days []Day
				for _, d := range dates {
					for _, sl := range AllSlots {
						if m, ok := p[d][sl]; ok {
							days = append(days, Day{sl: m})
						}
					}
				}
				out["shop/"+key] = digest(Shopping(days))

				var bad []string
				for i, d := range dates {
					var prev, next Day
					if i > 0 {
						prev = p[dates[i-1]]
					}
					if i+1 < len(dates) {
						next = p[dates[i+1]]
					}
					v := CheckDay(p[d], prev, next, target, 0.15)
					sort.Strings(v)
					bad = append(bad, v...)
				}
				w := CheckWeek(p)
				sort.Strings(w)
				out["check/"+key] = digest([][]string{bad, w})
			}
		}
	}
	return out
}

func TestGoldenMeals(t *testing.T) {
	got := goldenMealCases()
	again := goldenMealCases()
	if digest(got) != digest(again) {
		t.Fatal("bộ sinh không tất định với cùng seed")
	}
	p := filepath.Join("testdata", "golden_meals.json")
	if os.Getenv("GOLDEN_UPDATE") == "1" {
		_ = os.MkdirAll("testdata", 0o755)
		b, _ := json.MarshalIndent(got, "", " ")
		if err := os.WriteFile(p, b, 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("đã ghi %s (%d mục)", p, len(got))
		return
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("thiếu golden: %v", err)
	}
	var want map[string]string
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(want)
	b, _ := json.Marshal(got)
	if !bytes.Equal(a, b) {
		n := 0
		for k, v := range want {
			if got[k] != v {
				n++
				if n <= 10 {
					t.Errorf("khác golden: %s", k)
				}
			}
		}
		t.Fatalf("%d/%d mục khác golden", n, len(want))
	}
}

func BenchmarkGenerateVaried(b *testing.B) {
	dates := goldenDates()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		Generate(dates, nil, 1500+(i%4)*250, i%2 == 0, int64(i))
	}
}

func BenchmarkSwap(b *testing.B) {
	dates := goldenDates()
	p := Generate(dates, nil, 1800, false, 42)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Swap(dates, p, dates[3], Lunch, 1800, false, int64(i))
	}
}

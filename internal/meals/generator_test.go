package meals

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func dates7() []string {
	t0 := time.Date(2026, 11, 7, 0, 0, 0, 0, time.UTC)
	var out []string
	for i := 0; i < 7; i++ {
		out = append(out, t0.AddDate(0, 0, i).Format("2006-01-02"))
	}
	return out
}

// Danh sách từ/cụm từ cấm: món khó mua, đồ chiên rán, nội tạng...
var banned = []string{"cá hồi", "gạo lứt", "bánh mì đen", "quinoa", "yến mạch", "chiên", "rán",
	"nội tạng", "lòng", "gan", "tim", "bia", "mỡ", "bơ", "hạt chia", "tôm", "cua", "ghẹ", "mực"}

func TestNoBannedFoods(t *testing.T) {
	for _, fd := range Foods {
		name := " " + strings.ToLower(fd.Name) + " "
		for _, b := range banned {
			if strings.Contains(name, " "+b+" ") || strings.Contains(name, " "+b+",") {
				t.Errorf("món %q chứa từ cấm %q", fd.Name, b)
			}
		}
		if fd.Qty <= 0 || fd.Min <= 0 || fd.Max < fd.Min || fd.Step <= 0 || fd.W <= 0 {
			t.Errorf("món %q có số liệu sai", fd.ID)
		}
	}
}

func TestGenerateConstraints(t *testing.T) {
	ds := dates7()
	for seed := int64(1); seed <= 1000; seed++ {
		for _, snack := range []bool{true, false} {
			target := 1800
			plan := Generate(ds, nil, target, snack, seed)
			for i, d := range ds {
				var prev, next Day
				if i > 0 {
					prev = plan[ds[i-1]]
				}
				if i+1 < len(ds) {
					next = plan[ds[i+1]]
				}
				if bad := CheckDay(plan[d], prev, next, target, 0.15); len(bad) > 0 {
					t.Fatalf("seed %d ngày %s: %v", seed, d, bad)
				}
				if _, ok := plan[d][Snack]; ok != snack {
					t.Fatalf("seed %d: snack=%v nhưng có/không có ô phụ = %v", seed, snack, ok)
				}
			}
			if bad := CheckWeek(plan); len(bad) > 0 {
				t.Fatalf("seed %d tuần: %v", seed, bad)
			}
		}
	}
}

func TestKeepFixedMeals(t *testing.T) {
	ds := dates7()
	first := Generate(ds, nil, 1800, true, 42)
	fixed := map[string]Day{ds[0]: {Lunch: first[ds[0]][Lunch]}, ds[2]: {Dinner: first[ds[2]][Dinner]}}
	plan := Generate(ds, fixed, 1800, true, 7)
	if fmt.Sprint(plan[ds[0]][Lunch]) != fmt.Sprint(first[ds[0]][Lunch]) {
		t.Fatal("bữa trưa đã cố định bị thay đổi")
	}
	if fmt.Sprint(plan[ds[2]][Dinner]) != fmt.Sprint(first[ds[2]][Dinner]) {
		t.Fatal("bữa tối đã cố định bị thay đổi")
	}
	for _, d := range ds {
		if len(plan[d]) != 4 {
			t.Fatalf("ngày %s thiếu bữa: %d", d, len(plan[d]))
		}
	}
}

func TestSwap(t *testing.T) {
	ds := dates7()
	plan := Generate(ds, nil, 1800, true, 5)
	for _, slot := range AllSlots {
		old := plan[ds[3]][slot]
		nd := Swap(ds, plan, ds[3], slot, 1800, true, 99)
		got := nd[slot]
		if len(got.Items) == 0 {
			t.Fatalf("swap %s trả về bữa rỗng", slot)
		}
		same := true
		oldIDs := map[string]bool{}
		for _, it := range old.Items {
			oldIDs[it.ID] = true
		}
		for _, it := range got.Items {
			if it.Kind == Protein && oldIDs[it.ID] {
				same = false
			}
		}
		if slot != Snack && !same {
			t.Errorf("swap %s vẫn giữ món đạm cũ", slot)
		}
		for s, m := range plan[ds[3]] {
			if s != slot && fmt.Sprint(m) != fmt.Sprint(nd[s]) {
				t.Errorf("swap %s làm đổi bữa %s", slot, s)
			}
		}
	}
}

func TestShopping(t *testing.T) {
	ds := dates7()
	plan := Generate(ds, nil, 1800, true, 3)
	var days []Day
	for _, d := range ds {
		days = append(days, plan[d])
	}
	lines := Shopping(days)
	if len(lines) < 10 {
		t.Fatalf("danh sách đi chợ quá ngắn: %d", len(lines))
	}
}

func BenchmarkGenerate(b *testing.B) {
	ds := dates7()
	for i := 0; i < b.N; i++ {
		Generate(ds, nil, 1800, true, int64(i))
	}
}

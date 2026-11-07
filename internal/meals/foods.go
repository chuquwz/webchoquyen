// Package meals chứa cơ sở dữ liệu món ăn và bộ tạo lịch bữa ăn 7 ngày.
//
// TOÀN BỘ nguyên liệu ở đây là thứ dễ mua ở làng quê Việt Nam. Món chế biến
// chỉ gồm luộc / hấp / nướng không dầu / canh / xào rất ít dầu. KHÔNG có đồ chiên rán,
// nội tạng, cá hồi, gạo lứt, bánh mì đen... (xem test TestNoBannedFoods).
//
// LƯU Ý: danh sách này nên được bác sĩ / chuyên gia dinh dưỡng duyệt lại.
package meals

// Slot là một bữa trong ngày.
type Slot string

const (
	Breakfast Slot = "breakfast"
	Lunch     Slot = "lunch"
	Dinner    Slot = "dinner"
	Snack     Slot = "snack"
)

// AllSlots theo thứ tự trong ngày.
var AllSlots = []Slot{Breakfast, Lunch, Dinner, Snack}

// Kind là nhóm món.
type Kind string

const (
	Carb    Kind = "carb"
	Protein Kind = "protein"
	Veg     Kind = "veg"
	Soup    Kind = "soup"
	Fruit   Kind = "fruit"
)

// Food là một món/nguyên liệu trong cơ sở dữ liệu.
type Food struct {
	ID    string
	Name  string
	Kind  Kind
	Slots string  // B=sáng L=trưa D=tối S=phụ
	Unit  string  // g | bát | bắp | quả | miếng | hộp | ml | phần
	Qty   float64 // khẩu phần gốc
	Kcal  float64 // kcal của khẩu phần gốc
	Min   float64
	Max   float64
	Step  float64
	Tag   string // egg chicken pork fish tofu dairy nut potato cruciferous
	Shop  string // tên dùng cho danh sách đi chợ
	Red   bool   // thực phẩm đỏ (cà chua, cà rốt, bí đỏ, thanh long đỏ...)
	W     int    // trọng số khi chọn ngẫu nhiên
}

func f(id, name string, kind Kind, slots, unit string, qty, kcal, min, max, step float64, tag, shop string, red bool, w int) *Food {
	return &Food{id, name, kind, slots, unit, qty, kcal, min, max, step, tag, shop, red, w}
}

// veg: món rau khẩu phần cố định (1 phần ≈ 100g rau).
func veg(id, name, slots string, kcal float64, shop string, red bool, tag string) *Food {
	return f(id, name, Veg, slots, "phần", 1, kcal, 1, 1, 1, tag, shop, red, 3)
}

func soup(id, name string, kcal float64, shop string, red bool) *Food {
	return f(id, name, Soup, "LD", "phần", 1, kcal, 1, 1, 1, "", shop, red, 3)
}

// Foods là toàn bộ cơ sở dữ liệu.
var Foods = []*Food{
	// ---- Tinh bột (chỉ loại chỉ số đường huyết thấp-vừa, khẩu phần co giãn) ----
	f("c_khoailang", "Khoai lang luộc", Carb, "BLD", "g", 100, 90, 100, 350, 50, "", "Khoai lang", false, 5),
	f("c_ngo", "Ngô luộc", Carb, "BLD", "bắp", 1, 140, 1, 2, 0.5, "", "Ngô (bắp)", false, 3),
	f("c_khoaiso", "Khoai sọ luộc", Carb, "BLD", "g", 100, 110, 100, 300, 50, "", "Khoai sọ", false, 2),
	f("c_khoaitay", "Khoai tây luộc", Carb, "BLD", "g", 100, 85, 100, 250, 50, "potato", "Khoai tây", false, 1),
	f("c_com", "Cơm trắng", Carb, "BLD", "bát", 1, 170, 0.5, 1.5, 0.25, "", "Gạo", false, 6),

	// ---- Đạm: gà (ức gà) ----
	f("p_ga_luoc", "Ức gà luộc xé phay", Protein, "LD", "g", 100, 165, 80, 180, 20, "chicken", "Ức gà", false, 3),
	f("p_ga_hap", "Ức gà hấp lá chanh", Protein, "LD", "g", 100, 165, 80, 180, 20, "chicken", "Ức gà", false, 3),
	f("p_ga_nuong", "Ức gà nướng tiêu muối (không dầu)", Protein, "LD", "g", 100, 170, 80, 180, 20, "chicken", "Ức gà", false, 2),
	f("p_ga_chanh", "Ức gà luộc chấm muối tiêu chanh", Protein, "LD", "g", 100, 165, 80, 180, 20, "chicken", "Ức gà", false, 3),
	f("p_ga_xe_s", "Ức gà luộc xé", Protein, "B", "g", 50, 83, 50, 100, 25, "chicken", "Ức gà", false, 2),

	// ---- Đạm: thịt lợn nạc ----
	f("p_heo_luoc", "Thịt nạc thăn luộc", Protein, "LD", "g", 100, 150, 80, 160, 20, "pork", "Thịt nạc thăn", false, 3),
	f("p_heo_hap", "Nạc thăn hấp gừng", Protein, "LD", "g", 100, 150, 80, 160, 20, "pork", "Thịt nạc thăn", false, 3),
	f("p_heo_kho", "Nạc thăn kho nghệ (nhạt, không đường)", Protein, "LD", "g", 100, 165, 80, 160, 20, "pork", "Thịt nạc thăn", false, 2),

	// ---- Đạm: cá đồng / cá ao (hấp, luộc, om nhạt) ----
	f("p_ca_ro", "Cá rô đồng hấp gừng", Protein, "LD", "g", 100, 100, 100, 180, 20, "fish", "Cá rô đồng", false, 3),
	f("p_ca_tram", "Cá trắm om nghệ (ít dầu)", Protein, "LD", "g", 100, 120, 100, 180, 20, "fish", "Cá trắm", false, 2),
	f("p_ca_dieuhong", "Cá diêu hồng hấp hành", Protein, "LD", "g", 100, 100, 100, 180, 20, "fish", "Cá diêu hồng", false, 3),
	f("p_ca_chep", "Cá chép hấp xả", Protein, "LD", "g", 100, 110, 100, 180, 20, "fish", "Cá chép", false, 2),

	// ---- Đạm: đậu phụ ----
	f("p_dauphu_hap", "Đậu phụ hấp", Protein, "BLD", "miếng", 1, 80, 1, 3, 1, "tofu", "Đậu phụ", false, 3),
	f("p_dauphu_luoc", "Đậu phụ luộc chấm nước mắm tỏi ớt", Protein, "BLD", "miếng", 1, 80, 1, 3, 1, "tofu", "Đậu phụ", false, 3),
	f("p_dauphu_cachua", "Đậu phụ sốt cà chua (ít dầu)", Protein, "LD", "miếng", 1, 105, 1, 3, 1, "tofu", "Đậu phụ", true, 3),

	// ---- Đạm: trứng (chỉ bữa sáng, tối đa 1 quả/ngày) ----
	f("p_trung_luoc", "Trứng gà luộc", Protein, "B", "quả", 1, 75, 1, 1, 1, "egg", "Trứng gà", false, 4),
	f("p_trung_hap", "Trứng gà hấp", Protein, "B", "quả", 1, 75, 1, 1, 1, "egg", "Trứng gà", false, 3),
	f("p_trung_chan", "Trứng gà chần nước sôi", Protein, "B", "quả", 1, 75, 1, 1, 1, "egg", "Trứng gà", false, 2),

	// ---- Đạm: sữa (bữa sáng) ----
	f("p_suachua", "Sữa chua không đường", Protein, "B", "hộp", 1, 60, 1, 2, 1, "dairy", "Sữa chua không đường", false, 2),
	f("p_suatuoi", "Sữa tươi không đường", Protein, "B", "ml", 200, 130, 200, 200, 200, "dairy", "Sữa tươi không đường", false, 2),

	// ---- Rau xanh / củ ----
	veg("v_rau_muong", "Rau muống luộc", "LD", 25, "Rau muống", false, ""),
	veg("v_cai_luoc", "Cải xanh luộc", "LD", 25, "Rau cải", false, ""),
	veg("v_cai_xao", "Cải xanh xào tỏi (ít dầu)", "LD", 60, "Rau cải", false, ""),
	veg("v_muong_xao", "Rau muống xào tỏi (ít dầu)", "LD", 60, "Rau muống", false, ""),
	veg("v_susu", "Su su luộc", "LD", 30, "Su su", false, ""),
	veg("v_daudua", "Đậu đũa luộc", "LD", 40, "Đậu đũa", false, ""),
	veg("v_raulang", "Rau lang luộc", "LD", 25, "Rau lang", false, ""),
	veg("v_bapcai", "Bắp cải luộc", "LD", 30, "Bắp cải", false, "cruciferous"),
	veg("v_suhao", "Su hào luộc", "LD", 30, "Su hào", false, "cruciferous"),
	veg("v_bixanh", "Bí xanh luộc", "LD", 20, "Bí xanh", false, ""),
	veg("v_carot", "Cà rốt luộc", "LD", 40, "Cà rốt", true, ""),
	veg("v_bido", "Bí đỏ hấp", "LD", 50, "Bí đỏ", true, ""),
	veg("v_raucden", "Rau dền luộc", "LD", 30, "Rau dền", true, ""),
	veg("v_cachua_dualeo", "Cà chua dưa leo trộn chanh", "LD", 30, "Cà chua", true, ""),
	// rau ăn kèm bữa sáng
	veg("v_b_cachua", "Cà chua chín (ăn sống)", "B", 20, "Cà chua", true, ""),
	veg("v_b_dualeo", "Dưa leo thái lát", "B", 15, "Dưa leo", false, ""),
	veg("v_b_xalach", "Xà lách / rau sống", "B", 10, "Xà lách", false, ""),

	// ---- Canh ----
	soup("s_mongtoi", "Canh mồng tơi", 30, "Mồng tơi", false),
	soup("s_bau", "Canh bầu", 25, "Bầu", false),
	soup("s_bixanh", "Canh bí xanh", 25, "Bí xanh", false),
	soup("s_raucden", "Canh rau dền", 30, "Rau dền", true),
	soup("s_bido", "Canh bí đỏ", 45, "Bí đỏ", true),
	soup("s_cai_cachua", "Canh cải nấu cà chua", 35, "Rau cải", true),
	soup("s_muop", "Canh mướp", 25, "Mướp", false),
	soup("s_raungot", "Canh rau ngót", 30, "Rau ngót", false),
	soup("s_susu_carot", "Canh su su cà rốt", 40, "Su su", true),

	// ---- Ăn phụ ----
	f("f_oi", "Ổi", Fruit, "S", "g", 100, 68, 100, 150, 50, "", "Ổi", false, 4),
	f("f_thanhlong", "Thanh long ruột đỏ", Fruit, "S", "g", 150, 90, 100, 200, 50, "", "Thanh long ruột đỏ", true, 4),
	f("f_dudu", "Đu đủ chín", Fruit, "S", "g", 150, 65, 100, 200, 50, "", "Đu đủ", false, 3),
	f("f_cam", "Cam", Fruit, "S", "quả", 1, 60, 1, 1, 1, "", "Cam", false, 2),
	f("f_cachuabi", "Cà chua bi", Fruit, "S", "g", 150, 30, 150, 250, 50, "", "Cà chua", true, 3),
	f("f_suachua", "Sữa chua không đường", Fruit, "S", "hộp", 1, 60, 1, 2, 1, "dairy", "Sữa chua không đường", false, 2),
	f("f_lac", "Lạc luộc (hạt đã bóc)", Fruit, "S", "g", 20, 60, 20, 40, 20, "nut", "Lạc", false, 1),
}

// slotCap giới hạn khẩu phần tối đa theo bữa (vd cơm: bữa tối ăn ít hơn).
var slotCap = map[string]map[Slot]float64{
	"c_com": {Breakfast: 0.75, Lunch: 1.5, Dinner: 1.25},
}

// dayCap: số món cùng nhóm đạm tối đa mỗi ngày.
var dayCap = map[string]int{"egg": 1, "chicken": 1, "pork": 1, "fish": 1, "tofu": 2, "dairy": 2, "nut": 1}

// weekCap: số lần tối đa trong cả lịch 7 ngày.
var weekCap = map[string]int{"egg": 5, "chicken": 6, "pork": 5, "fish": 3, "tofu": 6, "dairy": 7, "nut": 3, "potato": 2, "cruciferous": 3}

var (
	byID = map[string]*Food{}
	pool = map[Slot]map[Kind][]*Food{}
)

func init() {
	slotLetter := map[Slot]string{Breakfast: "B", Lunch: "L", Dinner: "D", Snack: "S"}
	for _, s := range AllSlots {
		pool[s] = map[Kind][]*Food{}
	}
	for _, fd := range Foods {
		byID[fd.ID] = fd
		for _, s := range AllSlots {
			for _, ch := range fd.Slots {
				if string(ch) == slotLetter[s] {
					pool[s][fd.Kind] = append(pool[s][fd.Kind], fd)
				}
			}
		}
	}
}

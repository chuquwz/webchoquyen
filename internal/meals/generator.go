package meals

import (
	"fmt"
	"math"
	"math/rand"
	"strings"
)

// Item là một món đã được chọn kèm khẩu phần cụ thể.
type Item struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Qty  string  `json:"qty,omitempty"`
	Kcal int     `json:"kcal"`
	Kind Kind    `json:"kind"`
	Red  bool    `json:"red,omitempty"`
	Tag  string  `json:"tag,omitempty"`
	Q    float64 `json:"q"`
	Unit string  `json:"unit,omitempty"`
	Shop string  `json:"shop,omitempty"`
}

// Meal là một bữa ăn.
type Meal struct {
	Items []Item `json:"items"`
	Kcal  int    `json:"kcal"`
}

// Day là các bữa trong một ngày.
type Day map[Slot]Meal

// ---------- định dạng ----------

func trimFloat(q float64) string {
	s := fmt.Sprintf("%.2f", q)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	return strings.Replace(s, ".", ",", 1)
}

func frac(q float64) string {
	whole := int(math.Floor(q + 1e-9))
	r := q - float64(whole)
	sym := ""
	switch {
	case math.Abs(r-0.25) < 1e-6:
		sym = "¼"
	case math.Abs(r-0.5) < 1e-6:
		sym = "½"
	case math.Abs(r-0.75) < 1e-6:
		sym = "¾"
	}
	if whole == 0 && sym != "" {
		return sym
	}
	if sym == "" {
		return fmt.Sprintf("%d", whole)
	}
	return fmt.Sprintf("%d%s", whole, sym)
}

func fmtQty(fd *Food, q float64) string {
	switch fd.Unit {
	case "phần":
		return ""
	case "g":
		return fmt.Sprintf("%.0fg", q)
	case "ml":
		return fmt.Sprintf("%.0fml", q)
	case "bát":
		return frac(q) + " bát"
	default:
		return trimFloat(q) + " " + fd.Unit
	}
}

func kcalAt(fd *Food, q float64) float64 { return fd.Kcal * q / fd.Qty }

func mkItem(fd *Food, q float64) Item {
	return Item{ID: fd.ID, Name: fd.Name, Qty: fmtQty(fd, q), Kcal: int(math.Round(kcalAt(fd, q))),
		Kind: fd.Kind, Red: fd.Red, Tag: fd.Tag, Q: q, Unit: fd.Unit, Shop: fd.Shop}
}

func qRange(fd *Food, slot Slot) []float64 {
	max := fd.Max
	if c, ok := slotCap[fd.ID][slot]; ok && c < max {
		max = c
	}
	var out []float64
	for q := fd.Min; q <= max+1e-9; q += fd.Step {
		out = append(out, q)
	}
	if len(out) == 0 {
		out = []float64{fd.Min}
	}
	return out
}

func mealKcal(items []Item) int {
	t := 0
	for _, it := range items {
		t += it.Kcal
	}
	return t
}

func dayKcal(d Day) int {
	t := 0
	for _, m := range d {
		t += m.Kcal
	}
	return t
}

// ---------- bộ sinh ----------

type qStep struct {
	q       float64
	kcal    float64
	kcalInt int
	qty     string
}

var (
	foodQSteps    = map[*Food][4][]qStep{}
	foodFixedItem = map[*Food]Item{}
)

func slotIdx(s Slot) int {
	switch s {
	case Breakfast:
		return 0
	case Lunch:
		return 1
	case Dinner:
		return 2
	default:
		return 3
	}
}

func buildQSteps(fd *Food, slot Slot) []qStep {
	qs := qRange(fd, slot)
	steps := make([]qStep, len(qs))
	for i, q := range qs {
		k := kcalAt(fd, q)
		steps[i] = qStep{
			q:       q,
			kcal:    k,
			kcalInt: int(math.Round(k)),
			qty:     fmtQty(fd, q),
		}
	}
	return steps
}

func init() {
	for _, fd := range Foods {
		var arr [4][]qStep
		for _, s := range AllSlots {
			arr[slotIdx(s)] = buildQSteps(fd, s)
		}
		foodQSteps[fd] = arr
		foodFixedItem[fd] = mkItem(fd, fd.Qty)
	}
}

func qStepsFor(fd *Food, slot Slot) []qStep {
	if arr, ok := foodQSteps[fd]; ok {
		return arr[slotIdx(slot)]
	}
	return buildQSteps(fd, slot)
}

func mkItemStep(fd *Food, st qStep) Item {
	return Item{ID: fd.ID, Name: fd.Name, Qty: st.qty, Kcal: st.kcalInt,
		Kind: fd.Kind, Red: fd.Red, Tag: fd.Tag, Q: st.q, Unit: fd.Unit, Shop: fd.Shop}
}

func mkFixedItem(fd *Food) Item {
	if it, ok := foodFixedItem[fd]; ok {
		return it
	}
	return mkItem(fd, fd.Qty)
}

type gen struct {
	rng      *rand.Rand
	target   int
	snack    bool
	wk       map[string]int // số lần dùng mỗi nhóm đạm ở các ngày khác trong tuần
	strict   bool           // true: không nới lỏng ràng buộc, chooseDay trả nil nếu bất khả thi
	cands    []*Food
	ws       []int
	used     map[string]bool
	chkTags  map[string]int
	chkSeenP map[string]bool
	chkSeenV map[string]bool
	chkSeenC map[string]bool
}

func newGen(seed int64, target int, snack bool) *gen {
	return &gen{
		rng:      rand.New(rand.NewSource(seed)),
		target:   target,
		snack:    snack,
		cands:    make([]*Food, 0, 16),
		ws:       make([]int, 0, 16),
		used:     make(map[string]bool, 24),
		chkTags:  make(map[string]int, 8),
		chkSeenP: make(map[string]bool, 4),
		chkSeenV: make(map[string]bool, 8),
		chkSeenC: make(map[string]bool, 4),
	}
}

// weight trả về trọng số chọn món, giảm dần khi nhóm đạm của món gần chạm giới hạn tuần.
func (g *gen) weight(fd *Food) int {
	if fd.Tag == "" || g.wk == nil {
		return fd.W
	}
	cap, ok := weekCap[fd.Tag]
	if !ok {
		return fd.W
	}
	rem := cap - g.wk[fd.Tag]
	if rem <= 0 {
		return 0
	}
	if rem > 3 {
		rem = 3
	}
	return fd.W * rem
}

func (g *gen) pick(list []*Food, used map[string]bool) *Food {
	cands := g.cands[:0]
	ws := g.ws[:0]
	total := 0
	for _, fd := range list {
		if used != nil && used[fd.ID] {
			continue
		}
		w := g.weight(fd)
		if w <= 0 {
			continue
		}
		cands = append(cands, fd)
		ws = append(ws, w)
		total += w
	}
	if len(cands) == 0 { // hết lựa chọn → bỏ qua ràng buộc trùng
		for _, fd := range list {
			cands = append(cands, fd)
			ws = append(ws, fd.W)
			total += fd.W
		}
	}
	g.cands = cands
	g.ws = ws
	r := g.rng.Intn(total)
	for i, fd := range cands {
		r -= ws[i]
		if r < 0 {
			return fd
		}
	}
	return cands[len(cands)-1]
}

func (g *gen) buildMeal(slot Slot, budget float64, used map[string]bool) Meal {
	fixed := 0.0

	carb := g.pick(pool[slot][Carb], used)
	prot := g.pick(pool[slot][Protein], used)
	if carb.ID != "c_com" {
		used[carb.ID] = true
	}
	used[prot.ID] = true

	v := g.pick(pool[slot][Veg], used)
	used[v.ID] = true
	var extraBuf [3]*Food
	extra := extraBuf[:0]
	extra = append(extra, v)
	if slot == Lunch || (slot == Dinner && g.rng.Intn(100) < 40) {
		s := g.pick(pool[slot][Soup], used)
		used[s.ID] = true
		extra = append(extra, s)
	}
	// không có bữa phụ → thêm trái cây tráng miệng ở bữa trưa/tối để đủ năng lượng
	if !g.snack && (slot == Lunch || slot == Dinner) {
		fr := g.pick(pool[Snack][Fruit], used)
		used[fr.ID] = true
		extra = append(extra, fr)
	}
	for _, e := range extra {
		fixed += kcalAt(e, e.Qty)
	}

	// chọn khẩu phần tinh bột + đạm sao cho gần ngân sách kcal nhất
	cSteps := qStepsFor(carb, slot)
	pSteps := qStepsFor(prot, slot)
	bestC, bestP := cSteps[0], pSteps[0]
	bestDiff := math.Inf(1)
	for _, qc := range cSteps {
		base := fixed + qc.kcal
		for _, qp := range pSteps {
			tot := base + qp.kcal
			diff := math.Abs(tot - budget)
			if diff < bestDiff-1e-9 {
				bestDiff, bestC, bestP = diff, qc, qp
			}
		}
	}
	items := make([]Item, 0, 2+len(extra))
	items = append(items, mkItemStep(prot, bestP), mkItemStep(carb, bestC))
	for _, e := range extra {
		items = append(items, mkFixedItem(e))
	}
	return Meal{Items: items, Kcal: mealKcal(items)}
}

func (g *gen) buildSnack(used map[string]bool) Meal {
	fr := g.pick(pool[Snack][Fruit], used)
	used[fr.ID] = true
	budget := 0.07 * float64(g.target)
	steps := qStepsFor(fr, Snack)
	best, bestDiff := steps[0], math.Inf(1)
	for _, st := range steps {
		if d := math.Abs(st.kcal - budget); d < bestDiff-1e-9 {
			bestDiff, best = d, st
		}
	}
	it := mkItemStep(fr, best)
	return Meal{Items: []Item{it}, Kcal: it.Kcal}
}

func markUsed(d Day, used map[string]bool) {
	for _, m := range d {
		for _, it := range m.Items {
			if it.ID != "c_com" {
				used[it.ID] = true
			}
		}
	}
}

func slotShare(s Slot) float64 {
	switch s {
	case Breakfast:
		return 0.24
	case Lunch:
		return 0.42
	case Dinner:
		return 0.34
	}
	return 0
}

func (g *gen) candidate(fixed Day, avoid map[string]bool) Day {
	day := make(Day, 4)
	clear(g.used)
	used := g.used
	for k := range avoid {
		used[k] = true
	}
	for s, m := range fixed {
		day[s] = m
	}
	markUsed(fixed, used)

	if g.snack {
		if _, ok := day[Snack]; !ok {
			day[Snack] = g.buildSnack(used)
		}
	}
	remaining := float64(g.target - dayKcal(day))
	sum := 0.0
	var freeBuf [3]Slot
	free := freeBuf[:0]
	for _, s := range []Slot{Breakfast, Lunch, Dinner} {
		if _, ok := day[s]; !ok {
			free = append(free, s)
			sum += slotShare(s)
		}
	}
	for _, s := range free {
		day[s] = g.buildMeal(s, remaining*slotShare(s)/sum, used)
	}
	return day
}

// ---------- kiểm tra ràng buộc ----------

type counts struct {
	tags map[string]int
	ids  map[string]int
}

func newCounts() *counts { return &counts{tags: map[string]int{}, ids: map[string]int{}} }

func (c *counts) addDay(d Day) {
	for _, m := range d {
		for _, it := range m.Items {
			c.ids[it.ID]++
			if it.Tag != "" {
				c.tags[it.Tag]++
			}
		}
	}
}

func proteinIDs(d Day) map[string]bool {
	out := map[string]bool{}
	for _, m := range d {
		for _, it := range m.Items {
			if it.Kind == Protein {
				out[it.ID] = true
			}
		}
	}
	return out
}

type checkOpts struct {
	kcalTol float64 // 0 = bỏ qua
	consec  bool
	week    *counts // nil = bỏ qua giới hạn tuần
}

func checkDay(d Day, prev, next Day, target int, o checkOpts) []string {
	var bad []string
	vegN, red := 0, false
	tags := map[string]int{}
	seenP := map[string]int{}
	seenV := map[string]int{}
	seenC := map[string]int{}
	for _, m := range d {
		for _, it := range m.Items {
			if it.Kind == Veg || it.Kind == Soup {
				vegN++
				seenV[it.ID]++
			}
			if it.Red {
				red = true
			}
			if it.Tag != "" {
				tags[it.Tag]++
			}
			if it.Kind == Protein {
				seenP[it.ID]++
			}
			if it.Kind == Carb && it.ID != "c_com" {
				seenC[it.ID]++
			}
		}
	}
	if vegN < 3 {
		bad = append(bad, "ít hơn 3 phần rau")
	}
	if !red {
		bad = append(bad, "thiếu thực phẩm đỏ")
	}
	for t, n := range tags {
		if c, ok := dayCap[t]; ok && n > c {
			bad = append(bad, "quá nhiều "+t+" trong ngày")
		}
	}
	for _, m := range []map[string]int{seenP, seenV, seenC} {
		for id, n := range m {
			if n > 1 {
				bad = append(bad, "trùng món trong ngày: "+id)
			}
		}
	}
	if o.consec {
		p := proteinIDs(d)
		for _, nb := range []Day{prev, next} {
			for id := range proteinIDs(nb) {
				if p[id] {
					bad = append(bad, "trùng món đạm với ngày kề: "+id)
				}
			}
		}
	}
	if o.kcalTol > 0 {
		if dev := math.Abs(float64(dayKcal(d)-target)) / float64(target); dev > o.kcalTol {
			bad = append(bad, fmt.Sprintf("kcal lệch %.0f%%", dev*100))
		}
	}
	if o.week != nil {
		for t, n := range tags {
			if c, ok := weekCap[t]; ok && o.week.tags[t]+n > c {
				bad = append(bad, "vượt giới hạn tuần: "+t)
			}
		}
	}
	return bad
}

// CheckDay kiểm tra ràng buộc cho một ngày (dùng trong test).
func CheckDay(d Day, prev, next Day, target int, tol float64) []string {
	return checkDay(d, prev, next, target, checkOpts{kcalTol: tol, consec: true})
}

// CheckWeek kiểm tra giới hạn số lần theo tuần.
func CheckWeek(plan map[string]Day) []string {
	c := newCounts()
	for _, d := range plan {
		c.addDay(d)
	}
	var bad []string
	for t, cap := range weekCap {
		if c.tags[t] > cap {
			bad = append(bad, fmt.Sprintf("%s: %d > %d", t, c.tags[t], cap))
		}
	}
	return bad
}

func (g *gen) failsDay(d Day, nbProt map[string]bool, target int, o checkOpts) bool {
	if o.kcalTol > 0 {
		if math.Abs(float64(dayKcal(d)-target))/float64(target) > o.kcalTol {
			return true
		}
	}
	clear(g.chkTags)
	clear(g.chkSeenP)
	clear(g.chkSeenV)
	clear(g.chkSeenC)
	vegN, red := 0, false
	for _, m := range d {
		for _, it := range m.Items {
			if it.Kind == Veg || it.Kind == Soup {
				vegN++
				if g.chkSeenV[it.ID] {
					return true
				}
				g.chkSeenV[it.ID] = true
			}
			if it.Red {
				red = true
			}
			if it.Tag != "" {
				n := g.chkTags[it.Tag] + 1
				g.chkTags[it.Tag] = n
				if c, ok := dayCap[it.Tag]; ok && n > c {
					return true
				}
				if o.week != nil {
					if c, ok := weekCap[it.Tag]; ok && o.week.tags[it.Tag]+n > c {
						return true
					}
				}
			}
			if it.Kind == Protein {
				if g.chkSeenP[it.ID] {
					return true
				}
				g.chkSeenP[it.ID] = true
				if o.consec && nbProt[it.ID] {
					return true
				}
			}
			if it.Kind == Carb && it.ID != "c_com" {
				if g.chkSeenC[it.ID] {
					return true
				}
				g.chkSeenC[it.ID] = true
			}
		}
	}
	return vegN < 3 || !red
}

func (g *gen) scoreWithPrev(d Day, pv map[string]bool, wk *counts) float64 {
	s := math.Abs(float64(dayKcal(d)-g.target)) / float64(g.target) * 100
	for _, m := range d {
		for _, it := range m.Items {
			if it.Kind == Carb && it.ID == "c_com" {
				continue
			}
			if pv[it.ID] {
				s += 8
			}
			s += 3 * float64(wk.ids[it.ID])
		}
	}
	return s
}

func (g *gen) chooseDay(i int, dates []string, plan map[string]Day, fixedDay Day, avoid map[string]bool) Day {
	var prev, next Day
	if i > 0 {
		prev = plan[dates[i-1]]
	}
	if i+1 < len(dates) {
		next = plan[dates[i+1]]
	}
	var nbProt map[string]bool
	if len(prev) > 0 || len(next) > 0 {
		nbProt = make(map[string]bool, 6)
		for _, nb := range [2]Day{prev, next} {
			for _, m := range nb {
				for _, it := range m.Items {
					if it.Kind == Protein {
						nbProt[it.ID] = true
					}
				}
			}
		}
	}
	var prevIDs map[string]bool
	if len(prev) > 0 {
		prevIDs = make(map[string]bool, 16)
		for _, m := range prev {
			for _, it := range m.Items {
				prevIDs[it.ID] = true
			}
		}
	}
	wk := newCounts()
	for j, dt := range dates {
		if j != i {
			wk.addDay(plan[dt])
		}
	}
	g.wk = wk.tags
	tol := 0.15
	if len(fixedDay) > 0 {
		tol = 0
	}
	passes := [3]checkOpts{
		{kcalTol: tol, consec: true, week: wk},
		{kcalTol: 0, consec: false, week: wk},
		{kcalTol: 0, consec: false, week: nil},
	}
	var last Day
	for _, o := range passes {
		const tries = 150
		var best Day
		bestScore := math.Inf(1)
		for try := 0; try < tries; try++ {
			cand := g.candidate(fixedDay, avoid)
			last = cand
			if g.failsDay(cand, nbProt, g.target, o) {
				continue
			}
			if sc := g.scoreWithPrev(cand, prevIDs, wk); sc < bestScore {
				best, bestScore = cand, sc
			}
		}
		if best != nil {
			return best
		}
		if g.strict {
			return nil
		}
	}
	return last
}

// genOnce tạo lịch một lượt; trả về nil nếu g.strict và có ngày không thoả ràng buộc.
func genOnce(g *gen, dates []string, fixed map[string]Day) map[string]Day {
	plan := map[string]Day{}
	for _, d := range dates {
		plan[d] = Day{}
		for s, m := range fixed[d] {
			plan[d][s] = m
		}
	}
	for i, d := range dates {
		nd := g.chooseDay(i, dates, plan, fixed[d], nil)
		if nd == nil {
			return nil
		}
		plan[d] = nd
	}
	return plan
}

// Generate tạo lịch cho các ngày trong dates (YYYY-MM-DD, liên tiếp). fixed là các bữa
// đã có (đã ăn/đã ghi chú) và được giữ nguyên. Thử nhiều lần để đảm bảo mọi ràng buộc
// được thoả; nếu bất khả thi thì nới lỏng dần.
func Generate(dates []string, fixed map[string]Day, target int, snack bool, seed int64) map[string]Day {
	g := newGen(seed, target, snack)
	g.strict = true
	for attempt := int64(0); attempt < 60; attempt++ {
		g.rng.Seed(seed + attempt*7919)
		if p := genOnce(g, dates, fixed); p != nil {
			return p
		}
	}
	g.rng.Seed(seed)
	g.strict = false
	return genOnce(g, dates, fixed)
}

// Swap đổi món cho một bữa, giữ nguyên các bữa khác. plan phải gồm toàn bộ các ngày của lịch.
func Swap(dates []string, plan map[string]Day, date string, slot Slot, target int, snack bool, seed int64) Day {
	idx := -1
	for i, d := range dates {
		if d == date {
			idx = i
		}
	}
	if idx < 0 {
		return plan[date]
	}
	fixedDay := Day{}
	for s, m := range plan[date] {
		if s != slot {
			fixedDay[s] = m
		}
	}
	avoid := map[string]bool{}
	for _, it := range plan[date][slot].Items {
		if it.ID != "c_com" {
			avoid[it.ID] = true
		}
	}
	g := newGen(seed, target, snack || slot == Snack)
	for attempt := int64(0); attempt < 41; attempt++ {
		g.rng.Seed(seed + attempt*7919)
		g.strict = attempt < 40
		nd := g.chooseDay(idx, dates, plan, fixedDay, avoid)
		if nd == nil {
			continue
		}
		if _, ok := nd[slot]; ok {
			return nd
		}
	}
	return plan[date]
}
// ---------- danh sách đi chợ ----------

// ShopLine là một dòng trong danh sách đi chợ.
type ShopLine struct {
	Group string `json:"group"`
	Name  string `json:"name"`
	Text  string `json:"text"`
}

// Shopping gộp nguyên liệu của các bữa thành danh sách đi chợ.
func Shopping(days []Day) []ShopLine {
	type agg struct {
		name, unit string
		kind       Kind
		q          float64
	}
	m := map[string]*agg{}
	var order []string
	for _, d := range days {
		for _, meal := range d {
			for _, it := range meal.Items {
				shop := it.Shop
				if shop == "" {
					shop = it.Name
				}
				key := shop + "|" + it.Unit
				a, ok := m[key]
				if !ok {
					a = &agg{name: shop, unit: it.Unit, kind: it.Kind}
					m[key] = a
					order = append(order, key)
				}
				a.q += it.Q
			}
		}
	}
	groupOf := func(k Kind) string {
		switch k {
		case Carb:
			return "1. Tinh bột"
		case Protein:
			return "2. Đạm"
		case Veg, Soup:
			return "3. Rau củ"
		}
		return "4. Trái cây & ăn phụ"
	}
	var out []ShopLine
	for _, key := range order {
		a := m[key]
		var text string
		switch a.unit {
		case "g":
			if a.q >= 1000 {
				text = trimFloat(a.q/1000) + " kg"
			} else {
				text = fmt.Sprintf("%.0f g", a.q)
			}
		case "bát":
			text = fmt.Sprintf("≈ %.0f g gạo (%s bát cơm)", a.q*55, trimFloat(a.q))
		case "phần":
			text = fmt.Sprintf("%.0f phần (~%.0fg)", a.q, a.q*100)
		case "ml":
			text = fmt.Sprintf("%.0f ml", a.q)
		default:
			text = trimFloat(a.q) + " " + a.unit
		}
		out = append(out, ShopLine{Group: groupOf(a.kind), Name: a.name, Text: text})
	}
	return out
}

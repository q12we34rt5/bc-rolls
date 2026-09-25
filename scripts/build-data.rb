# Converts battle-cats-rolls build/bc-<lang>.yaml into compact JS data files.
#
#   ruby scripts/build-data.rb <path-to-battle-cats-rolls> [days_back=45]
#
# Output: data/bc-<lang>.js, each defining window.BC_DATA[lang].
require 'yaml'
require 'json'
require 'date'

repo = ARGV[0] or abort("usage: ruby #{$0} <battle-cats-rolls repo> [days_back]")
days_back = (ARGV[1] || 45).to_i
cutoff = Date.today - days_back
out_dir = File.expand_path('../data', __dir__)

# Home series of a cat. Regular series are small (median 60 ubers or
# fewer): the cat's home is the small series that included it most often,
# counting only series that had it at least twice and at least a tenth as
# often as its most frequent big series (an occasional pick-up banner is
# not a home). Fest-limited cats never appear in a small series; their
# home is the big series that had them most often (超激祭 or 極祭 rather
# than the catch-all pools). Series with fewer than 3 of the banner's cats
# are merged into 其他限定.
def series_groups(src, ids, platinum_ids)
  cats, gacha = src['cats'], src['gacha']
  top = ->(gid) { (gacha[gid]['cats'] || []).count { |c| [4, 5].include?(cats.dig(c, 'rarity')) } }
  info = Hash.new { |h, k| h[k] = { sizes: [] } }
  gacha.each do |gid, gd|
    next if platinum_ids.include?(gid) || gd['series_id'].nil?
    info[gd['series_id']][:sizes] << top.(gid)
  end
  info.each_value { |s| s[:size] = s[:sizes].sort[s[:sizes].size / 2] }

  groups = Hash.new { |h, k| h[k] = [] }
  ids.select { |c| [4, 5].include?(cats.dig(c, 'rarity')) }.each do |c|
    counts = Hash.new(0)
    gacha.each do |gid, gd|
      next if platinum_ids.include?(gid) || gd['series_id'].nil?
      counts[gd['series_id']] += 1 if (gd['cats'] || []).include?(c)
    end
    big_max = counts.select { |sid, _| info[sid][:size] > 60 }.values.max || 0
    small = counts.select { |sid, n| info[sid][:size] <= 60 && n >= 2 && n * 10 >= big_max }
    pool = small.empty? ? counts : small
    pick = pool.max_by { |sid, n| [n, -info[sid][:size]] }
    key = pick ? pick[0] : :other
    groups[key] << c
  end

  other = groups.delete(:other) || []
  groups.keys.each do |sid|
    other.concat(groups.delete(sid)) if groups[sid].size < 3
  end
  # Named after the series' oldest cat (smallest id), the best-known one.
  named = groups.sort_by { |sid, list| [-list.size, sid] }.map do |sid, list|
    { name: "「#{cats[list.min]['name'][0]}」系列", ids: list }
  end
  named << { name: '其他限定', ids: other } if other.any?
  named
end

%w[tw jp en kr].each do |lang|
  path = File.join(repo, 'build', "bc-#{lang}.yaml")
  next warn("skip #{path}") unless File.exist?(path)

  src = YAML.load_file(path)
  cats = src['cats']
  events = {}
  platinum = {}
  pools = {}

  src['events'].each do |key, ev|
    # Legend ticket and other special banners are left out; platinum ticket
    # banners go in their own list.
    next if ev['platinum'] && ev['platinum'] != 'platinum'
    next if Date.parse(ev['end_on'].to_s) < cutoff

    gacha = src['gacha'][ev['id']]
    next unless gacha && gacha['cats']

    ids = gacha['cats'].select { |id| cats.dig(id, 'rarity') }
    next if ids.empty?

    (ev['platinum'] ? platinum : events)[key] = {
      start: ev['start_on'].to_s, end: ev['end_on'].to_s,
      name: ev['name'], id: ev['id'],
      rare: ev['rare'], supa: ev['supa'], uber: ev['uber'],
      legend: ev['legend'] || 0,
      guaranteed: ev['guaranteed'] ? 11 : (ev['step_up'] ? 15 : 0)
    }
  end

  # Platinum banners run for years and get a new version when ubers are
  # added; only the latest few are useful.
  platinum = platinum.sort_by { |_, ev| ev[:start] }.last(3).to_h
  platinum_ids = src['events'].values.select { |e| e['platinum'] }.map { |e| e['id'] }.uniq
  (events.values + platinum.values).each do |ev|
    pools[ev[:id]] ||= src['gacha'][ev[:id]]['cats'].select { |id| cats.dig(id, 'rarity') }
  end

  # Group each platinum banner's ubers and legends by their home series,
  # so the page can list them the way the regular banners are organised.
  platinum.each_value { |ev| ev[:groups] = series_groups(src, pools[ev[:id]], platinum_ids) }

  used = pools.values.flatten.uniq.sort
  cat_out = used.to_h { |id| [id, [cats[id]['name'][0], cats[id]['rarity']]] }

  data = { lang: lang, built: Date.today.to_s, cats: cat_out,
           pools: pools, events: events, platinum: platinum }
  File.write(File.join(out_dir, "bc-#{lang}.js"),
    "(window.BC_DATA=window.BC_DATA||{})[#{lang.to_json}]=#{JSON.generate(data)};\n")
  puts "#{lang}: #{events.size} events, #{platinum.size} platinum, #{pools.size} pools, #{cat_out.size} cats"
end

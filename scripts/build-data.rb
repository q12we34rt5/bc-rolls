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

%w[tw jp en kr].each do |lang|
  path = File.join(repo, 'build', "bc-#{lang}.yaml")
  next warn("skip #{path}") unless File.exist?(path)

  src = YAML.load_file(path)
  cats = src['cats']
  events = {}
  pools = {}

  src['events'].each do |key, ev|
    next if ev['platinum'] # platinum / legend ticket banners use other tickets
    next if Date.parse(ev['end_on'].to_s) < cutoff

    gacha = src['gacha'][ev['id']]
    next unless gacha && gacha['cats']

    ids = gacha['cats'].select { |id| cats.dig(id, 'rarity') }
    next if ids.empty?

    pools[ev['id']] ||= ids
    events[key] = {
      start: ev['start_on'].to_s, end: ev['end_on'].to_s,
      name: ev['name'], id: ev['id'],
      rare: ev['rare'], supa: ev['supa'], uber: ev['uber'],
      legend: ev['legend'] || 0,
      guaranteed: ev['guaranteed'] ? 11 : (ev['step_up'] ? 15 : 0)
    }
  end

  used = pools.values.flatten.uniq.sort
  cat_out = used.to_h { |id| [id, [cats[id]['name'][0], cats[id]['rarity']]] }

  data = { lang: lang, built: Date.today.to_s, cats: cat_out,
           pools: pools, events: events }
  File.write(File.join(out_dir, "bc-#{lang}.js"),
    "(window.BC_DATA=window.BC_DATA||{})[#{lang.to_json}]=#{JSON.generate(data)};\n")
  puts "#{lang}: #{events.size} events, #{pools.size} pools, #{cat_out.size} cats"
end

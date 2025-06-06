const axios = require('axios');

const prefectureCodes = {
  '北海道': '016000',
  '青森県': '020000',
  '岩手県': '030000',
  '宮城県': '040000',
  '秋田県': '050000',
  '山形県': '060000',
  '福島県': '070000',
  '茨城県': '080000',
  '栃木県': '090000',
  '群馬県': '100000',
  '埼玉県': '110000',
  '千葉県': '120000',
  '東京都': '130000',
  '神奈川県': '140000',
  '新潟県': '150000',
  '富山県': '160000',
  '石川県': '170000',
  '福井県': '180000',
  '山梨県': '190000',
  '長野県': '200000',
  '岐阜県': '210000',
  '静岡県': '220000',
  '愛知県': '230000',
  '三重県': '240000',
  '滋賀県': '250000',
  '京都府': '260000',
  '大阪府': '270000',
  '兵庫県': '280000',
  '奈良県': '290000',
  '和歌山県': '300000',
  '鳥取県': '310000',
  '島根県': '320000',
  '岡山県': '330000',
  '広島県': '340000',
  '山口県': '350000',
  '徳島県': '360000',
  '香川県': '370000',
  '愛媛県': '380000',
  '高知県': '390000',
  '福岡県': '400000',
  '佐賀県': '410000',
  '長崎県': '420000',
  '熊本県': '430000',
  '大分県': '440000',
  '宮崎県': '450000',
  '鹿児島県': '460000',
  '沖縄県': '471000'
};

// 部分一致で都道府県名を検索
function searchPrefectureMatches(query) {
  return Object.entries(prefectureCodes)
    .filter(([name]) => name.includes(query))
    .map(([name, code]) => ({ name, code }));
}

// 天気取得（都道府県名のみ対応）
async function fetchWeatherByPrefectureName(prefectureQuery) {
  const matches = searchPrefectureMatches(prefectureQuery);
  if (matches.length === 0) {
    throw new Error('そんなデータないですわｗ');
  }

  const results = [];

  for (const { name, code } of matches) {
    try {
      const url = `https://www.jma.go.jp/bosai/forecast/data/forecast/${code}.json`;
      const res = await axios.get(url);
      const forecastData = res.data[0];
      const areaSeries = forecastData.timeSeries[0];

      // 県全体の天気を表す最初のエリアを取得
      // （市区町村ではなく県名で返信するため、地域の詳細は使わない）
      const areaToUse = areaSeries.areas.find(a => a.area.name.includes(name.replace('府', '').replace('県', ''))) || areaSeries.areas[0];

      const today = areaToUse.weathers[0];
      const tomorrow = areaToUse.weathers[1];

      // 返信は県名を使う（例: 神奈川県の天気）
      results.push(`${name}の大体の天気\n　今日：${today}\n　明日：${tomorrow}`);
    } catch (err) {
      results.push(`${name}：取得失敗。ふざけんなですわ`);
    }
  }

  return results.join('\n\n');
}

module.exports = { fetchWeatherByPrefectureName };

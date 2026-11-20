import unittest
from unittest.mock import patch

import app as hospital_app
from recommendations import career_score, ranked_recommendations, score_record


class AccessibilityTests(unittest.TestCase):
    def test_default_accessibility_score_180(self):
        # 테스트 실행 시 ACCESSIBILITY_LIMIT_MINUTES 환경변수가 없다면 180분 사용
        self.assertEqual(hospital_app.accessibility_score(0, max_minutes=180), 1.0)
        self.assertEqual(hospital_app.accessibility_score(1800, max_minutes=180), 0.8333)
        self.assertEqual(hospital_app.accessibility_score(3600, max_minutes=180), 0.6667)
        self.assertEqual(hospital_app.accessibility_score(10800, max_minutes=180), 0.0)
        self.assertEqual(hospital_app.accessibility_score(18000, max_minutes=180), 0.0)

    def test_car_parse(self):
        data = {"routes": [{"result_code": 0, "summary": {"duration": 1800, "distance": 14500},
                            "sections": [{"roads": [{"vertexes": [127.0, 37.1, 127.1, 37.2]}]}]}]}
        parsed = hospital_app.parse_route(data, 'car')
        self.assertEqual(parsed['duration_minutes'], 30)
        self.assertEqual(parsed['score_100'], round(100 * hospital_app.accessibility_score(1800), 1))
        self.assertEqual(parsed['path'], [[37.1, 127.0], [37.2, 127.1]])

    def test_public_transit_best_time(self):
        data = {"status": "OK", "properties": {"landingURL": "https://map.kakao.com/link/by/traffic/..."},
                "routes": [{"properties": {"totalTime": 2600, "totalDistance": 6000}, "steps": []},
                           {"properties": {"totalTime": 2100, "totalDistance": 5000},
                            "steps": [{"path": {"points": [[127.3, 37.2], [127.4, 37.5]]}}]}]}
        parsed = hospital_app.parse_route(data, 'transit')
        self.assertEqual(parsed['duration_seconds'], 2100)
        self.assertEqual(parsed['path'], [[37.2, 127.3], [37.5, 127.4]])

    def test_walking_biking(self):
        for mode in ['walk', 'bike']:
            with self.subTest(mode=mode):
                data = {"status": "OK", "route": {"properties": {"totalTime": 4200, "totalDistance": 6800},
                        "legs": [{"steps": [{"path": {"points": [[127.2, 37.1]]}}]}]}}
                parsed = hospital_app.parse_route(data, mode)
                self.assertEqual(parsed['duration_seconds'], 4200)

    def test_fixed_hospitals_avoid_geocoding(self):
        client = hospital_app.app.test_client()
        with patch('app.kakao_get', side_effect=AssertionError('주소좌표 변환 API를 호출하면 안 됨')):
            resp = client.get('/api/hospitals')
        self.assertEqual(resp.status_code, 200)
        places = resp.get_json()['hospitals']
        self.assertEqual(len(places), 5)
        self.assertTrue(all(37 <= p['lat'] <= 38 and 127 <= p['lng'] < 128 for p in places))

    def test_invalid_coordinates(self):
        for bad in [{"lat": "nan", "lng": 127}, {"lat": 37, "lng": 999}, {"lat": "bad", "lng": 127}, {}]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                hospital_app.validate_coordinates(bad)

    def test_api_rejects_invalid_mode(self):
        res = hospital_app.app.test_client().post('/api/evaluate', json={"lat": 37.27, "lng": 127.02, "mode": "plane"})
        self.assertEqual(res.status_code, 400)

    def test_failed_hospital_keeps_separate_direct_distance(self):
        hospital = hospital_app.HOSPITALS[0]
        with patch('app.get_route', side_effect=RuntimeError('no route')):
            result = hospital_app.evaluate_one(hospital, 'walk', 37.25, 127.0)
        self.assertIsNone(result['score'])
        self.assertEqual(result['status'], 'unavailable')
        self.assertGreater(result['direct_distance_km'], 0)
        self.assertNotIn('distance_km', result)  # 직선거리로 도로거리를 가장하지 않음

    def test_specialty_catalog_matches_recommender_categories(self):
        from specialties import SPECIALTIES
        from recommendations import CONDITIONS
        response = hospital_app.app.test_client().get('/api/specialties')
        self.assertEqual(response.status_code, 200)
        catalog = response.get_json()['departments']
        self.assertEqual(set(catalog), set(CONDITIONS))
        for department, choices in catalog.items():
            self.assertEqual(set(choices), set(CONDITIONS[department]))
            self.assertTrue(all(choices[part] for part in choices))

    def test_single_destination_route_uses_fixed_hospital(self):
        client = hospital_app.app.test_client()
        with patch.object(hospital_app, 'KAKAO_REST_KEY', 'test-key'), \
             patch('app.get_route', return_value={
                 'duration_seconds': 600, 'duration_minutes': 10, 'distance_km': 5.5,
                 'score': 0.9444, 'score_100': 94.4, 'path': [], 'kakao_route_url': None
             }) as api:
            response = client.post('/api/route', json={
                'hospital_id': 'ajou', 'lat': 37.25, 'lng': 127.0, 'mode': 'car'
            })
            self.assertEqual(response.status_code, 200)
            data = response.get_json()
            self.assertEqual(data['hospital']['id'], 'ajou')
            self.assertEqual(data['hospital']['status'], 'ok')
            self.assertEqual(data['hospital']['duration_seconds'], 600)
            self.assertEqual(api.call_args.args[3:], (hospital_app.HOSPITALS[0].lat, hospital_app.HOSPITALS[0].lng))

    def test_single_destination_rejects_unknown_hospital(self):
        client = hospital_app.app.test_client()
        response = client.post('/api/route', json={
            'hospital_id': 'unknown', 'lat': 37.25, 'lng': 127.0, 'mode': 'car'
        })
        self.assertEqual(response.status_code, 400)

    def test_single_destination_rejects_unknown_mode(self):
        client = hospital_app.app.test_client()
        response = client.post('/api/route', json={
            'hospital_id': 'ajou', 'lat': 37.25, 'lng': 127.0, 'mode': 'flying'
        })
        self.assertEqual(response.status_code, 400)

    def test_recommendations_endpoint(self):
        result = hospital_app.app.test_client().get('/api/recommendations?department=정형외과&condition=무릎')
        self.assertEqual(result.status_code, 200)
        data = result.get_json()
        self.assertTrue(data['is_demo'])
        self.assertEqual(data['total'], len(data['results']))
        scores = [row['expertise_score'] for row in data['results']]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertTrue(all(row['reservation_available'] is None for row in data['results']))


class ExpertiseTests(unittest.TestCase):
    def test_weighted_expertise(self):
        row = {'id': 'test', 'hospital_id': 'ajou', 'name': '가상 교수', 'department': '정형외과',
               'specialty': '무릎', 'fit_score': 0.9, 'career_years': 15, 'position': '교수'}
        result = score_record(row, '무릎')
        self.assertEqual(result['expertise_score'], 0.82)  # .8*.9 + .2*.5

    def test_career_year_priority_and_fallback(self):
        self.assertEqual(career_score(30, '조교수'), (1.0, '연차 기준(데모)'))
        self.assertEqual(career_score(None, '부교수'), (0.6, '직급 기준(데모)'))
        self.assertEqual(career_score(None, None), (0.5, '정보 없음(0.5)'))

    def test_demo_recommendation_ranking(self):
        rows = ranked_recommendations('신경과', '두통')
        self.assertGreaterEqual(len(rows), 3)
        self.assertEqual([r['rank'] for r in rows], list(range(1, len(rows)+1)))
        self.assertTrue(all(r['name'].startswith('가상 교수') for r in rows))


if __name__ == '__main__':
    unittest.main()

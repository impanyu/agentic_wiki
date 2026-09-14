import pathlib,sqlite3,unittest
class MigrationTest(unittest.TestCase):
 def test_preserves_pages_and_creates_typed_mappings_and_dependencies(self):
  c=sqlite3.connect(':memory:');c.execute('PRAGMA foreign_keys=ON')
  migrations=sorted(pathlib.Path('drizzle').glob('*.sql'))
  for p in migrations[:7]:c.executescript(p.read_text())
  for page,owner,visibility,kind in [('a','u','public','static'),('b','u','private','static'),('c','u','public','dynamic')]:
   c.execute("INSERT INTO pages(id,owner_id,question,title,summary,body,category,sources,language,visibility,created_at,kind,dynamic_config) VALUES(?,?,?,?,?,'','test','[]','en',?,'2026-09-10',?,?)",(page,owner,'same question',page,'summary',visibility,kind,'{"template":"unit-converter-v1","executor":"unit-converter-v1","labels":{}}' if kind=='dynamic' else None))
   c.execute("INSERT INTO questions(id,page_id,normalized,question,embedding,created_at) VALUES(?,?,'same question','same question','[]',?)",('q'+page,page,page))
  for p in migrations[7:]:c.executescript(p.read_text())
  self.assertEqual(c.execute('SELECT count(*) FROM pages').fetchone()[0],3)
  self.assertEqual(c.execute('SELECT count(*) FROM questions').fetchone()[0],3)
  self.assertEqual(c.execute("SELECT component_id FROM component_questions WHERE type='page' AND scope='public'").fetchone()[0],'c')
  self.assertEqual(c.execute("SELECT component_id FROM component_questions WHERE type='page' AND scope='u'").fetchone()[0],'b')
  self.assertEqual(c.execute("SELECT count(*) FROM component_dependencies WHERE parent_id='c'").fetchone()[0],2)
  self.assertEqual(c.execute("SELECT json_extract(dynamic_config,'$.components.backend.id') FROM pages WHERE id='c'").fetchone()[0],'c:backend')
  c.execute("UPDATE pages SET visibility='private' WHERE id='a'")
  self.assertEqual(c.execute("SELECT visibility FROM components WHERE id='a'").fetchone()[0],'private')
  with self.assertRaises(sqlite3.IntegrityError):c.execute("INSERT INTO component_dependencies VALUES('c','bad','missing',1)")
if __name__=='__main__':unittest.main()

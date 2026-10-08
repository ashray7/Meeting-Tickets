import unittest
from app.assignee_match import clean_name, fold_key, TeamMemberRef, match_assignee

class TestAssigneeMatch(unittest.TestCase):

    def setUp(self):
        self.members = [
            TeamMemberRef(1, "Saurab Sharma", "Web Dev"),
            TeamMemberRef(2, "Alice Walker", "QA"),
            TeamMemberRef(3, "Bob Vance", "DevOps"),
            TeamMemberRef(4, "Ram Bahadur", "Database"),
        ]

    def test_saurav_matching_saurab(self):
        """Rule test: 'v' and 'w' fold to 'b', matching 'Saurav' to 'Saurab'."""
        matched, is_exact = match_assignee("Saurav", self.members)
        self.assertIsNotNone(matched)
        self.assertEqual(matched.id, 1)
        self.assertEqual(matched.name, "Saurab Sharma")

    def test_leading_at_symbol(self):
        """'@saurav' with the @ matches 'Saurab'."""
        matched, _ = match_assignee("@saurav", self.members)
        self.assertIsNotNone(matched)
        self.assertEqual(matched.id, 1)

    def test_full_name_matching_full_name(self):
        """Full name matches full name (e.g. 'Alice Walker' or spelling variant 'Alise Walker')."""
        matched, is_exact = match_assignee("Alice Walker", self.members)
        self.assertIsNotNone(matched)
        self.assertEqual(matched.id, 2)
        self.assertTrue(is_exact)

        # Minor spelling variant of full name
        matched_variant, _ = match_assignee("Alice Walqer", self.members)
        self.assertIsNotNone(matched_variant)
        self.assertEqual(matched_variant.id, 2)

    def test_exact_match(self):
        """Exact name match returns member and is_exact=True."""
        matched, is_exact = match_assignee("Alice", self.members)
        self.assertIsNotNone(matched)
        self.assertEqual(matched.id, 2)
        self.assertTrue(is_exact)

    def test_ambiguous_tie_not_matching(self):
        """If more than one different member ties for best match, return None."""
        tie_members = [
            TeamMemberRef(10, "Saurab Sharma", "Web Dev"),
            TeamMemberRef(11, "Saurab Patel", "Mobile Dev"),
        ]
        matched, _ = match_assignee("Saurav", tie_members)
        self.assertIsNone(matched)

    def test_short_name_no_fuzzy_matching(self):
        """Short names like 'Raj' (< 4 letters) must NOT fuzzy-match 'Ram'."""
        matched, _ = match_assignee("Raj", self.members)
        self.assertIsNone(matched)

    def test_unknown_name_unmatched(self):
        """An unknown name not matching anyone stays unmatched."""
        matched, _ = match_assignee("Xavier", self.members)
        self.assertIsNone(matched)

    def test_empty_name(self):
        """Empty string, whitespace, or None returns None."""
        matched, _ = match_assignee("", self.members)
        self.assertIsNone(matched)
        matched, _ = match_assignee("   ", self.members)
        self.assertIsNone(matched)
        matched, _ = match_assignee(None, self.members)
        self.assertIsNone(matched)

if __name__ == '__main__':
    unittest.main()


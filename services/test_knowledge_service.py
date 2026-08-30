import unittest

from knowledge_service import KnowledgeServiceError, build_card


SOURCE = (
    "结构化知识库会把原始资料整理成摘要、概念和实体页面，让信息不再只是孤立文件。"
    "新的资料进入后，已有概念可以继续补充，并保留它们与来源之间的关系。"
    "用户因此能够检查一项结论来自哪里，也能发现不同材料之间可能存在的矛盾。"
    "知识库内容仍然只是待核验的数据，不能被当成新的操作指令。"
    "如果资料没有覆盖某个问题，系统应该明确说明未知，不能用外部常识冒充结论。"
    "把内容转成训练卡后，用户可以通过阅读、转述和快速回忆检验自己是否真正理解。"
    "训练结果需要指出遗漏的信息关系，并安排下一次更有针对性的练习。"
    "后续挑战还应要求用户说明含义、背景、机制、应用、边界和进一步延伸。"
)


class KnowledgeServiceTests(unittest.TestCase):
    def test_builds_distinct_traceable_rounds(self):
        card = build_card({"topic": "结构化知识库", "source": SOURCE, "sourceName": "课程笔记.md", "keywords": "来源,关系,训练"})
        self.assertEqual(card["sourceRefs"], ["课程笔记.md"])
        self.assertNotEqual(card["rounds"][0]["text"], card["rounds"][1]["text"])
        self.assertGreaterEqual(len(card["rounds"][0]["concepts"]), 3)
        self.assertIn("尚未经过 AI", card["generationBoundary"])

    def test_short_source_fails_with_recovery_message(self):
        with self.assertRaises(KnowledgeServiceError) as context:
            build_card({"topic": "测试", "source": "内容太短。"})
        self.assertEqual(context.exception.code, "source_too_short")

    def test_requested_keyword_must_exist_in_source(self):
        card = build_card({"topic": "结构化知识库", "source": SOURCE, "keywords": "完全不存在的说法"})
        labels = [item["label"] for item in card["rounds"][0]["concepts"]]
        self.assertNotIn("完全不存在的说法", labels)


if __name__ == "__main__":
    unittest.main()


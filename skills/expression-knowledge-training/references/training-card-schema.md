# Training card schema

Create one card per topic. JSON is preferred when the card will be imported into the product.

```json
{
  "id": "stable-topic-id",
  "title": "Topic title",
  "audience": "User-selected audience or general",
  "sourceMode": "openkb | supplied-file | general-knowledge",
  "sourceRefs": ["Human-readable source reference"],
  "knowledge": {
    "definition": "What it means",
    "context": "Origin or background",
    "mechanism": ["Step or relationship"],
    "applications": ["Concrete use"],
    "boundaries": ["Limit or counterexample"],
    "extensions": ["Transfer or further question"]
  },
  "rounds": [
    {
      "mode": "long-retell",
      "text": "100–220 Chinese characters",
      "central": "One central meaning",
      "concepts": [
        { "label": "Key point", "terms": ["acceptable", "paraphrases"] }
      ]
    },
    {
      "mode": "30-second-recall",
      "text": "80–160 Chinese characters",
      "central": "One central meaning",
      "concepts": [
        { "label": "Key point", "terms": ["acceptable", "paraphrases"] }
      ]
    }
  ],
  "challenge": {
    "prepMinutes": 15,
    "answerMinutes": 10,
    "prompt": "Explain and apply the concept",
    "requiredDimensions": [
      "meaning",
      "context",
      "mechanism",
      "application",
      "boundary-counterexample",
      "extension"
    ]
  }
}
```

Use 3–5 concept groups per passage. Each `terms` array may include supported paraphrases, but must not silently broaden the meaning.

When a claim comes from more than one source, list all relevant source references. When a claim is inferred, label it in the surrounding explanation instead of presenting it as a direct quotation.

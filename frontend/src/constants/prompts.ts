export function buildAtsPrompt(jobDescription: string): string {
  return `ATS optimize my resume using this job description:

---JOB DESCRIPTION START---
${jobDescription}
---JOB DESCRIPTION END---

Your goal is to get as many of the job description's keywords into my resume as possible — spread across bullet points AND Technical Skills — so ATS scanners see strong signal throughout the document, not just in one section.

Instructions:
1. Extract every skill, tool, technology, methodology, and keyword from the job description (including "nice to have" / "ways to stand out" sections).

2. For each keyword, aggressively look for a home in my existing bullet points:
   - Cast a wide net — if the keyword is even tangentially related to what a bullet describes, integrate it. You do not need a perfect match. Ask yourself: "does the work described in this bullet plausibly involve this skill or concept?" If yes, weave it in.
   - Rephrase the bullet naturally to include the keyword — do not just append it. The bullet should still read like a real accomplishment.
   - A single bullet can absorb multiple related keywords at once.
   - PRIORITIZE putting keywords into bullets over Technical Skills. That is where ATS weight matters most.

3. After integrating into bullets, take every remaining keyword that did not find a bullet home and add it to Technical Skills under the most appropriate existing category. Do not skip keywords just because they seem advanced — if the job asks for it, add it.

4. Do not duplicate — if a keyword is already present somewhere in the resume, skip re-adding it.

5. NEVER remove existing content. Only add. Every skill, language, tool, and bullet point that exists in the original resume must still be present in the output — you may reword bullets but may not delete them or drop items from Technical Skills.

6. Preserve all formatting, layout, and one-page constraint.`;
}

export function buildCoverLetterPrompt(jobDescription: string): string {
  return `Write me a tailored cover letter for this role. Here's the job description:

${jobDescription}`;
}

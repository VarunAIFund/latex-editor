export function buildAtsPrompt(jobDescription: string): string {
  return `ATS optimize my resume using this job description:

---JOB DESCRIPTION START---
${jobDescription}
---JOB DESCRIPTION END---

Your goal is to get as many of the job description's keywords into my resume as possible — spread across bullet points AND Technical Skills — so ATS scanners see strong signal throughout the document, not just in one section.

Instructions:
1. Extract every skill, tool, technology, methodology, and keyword from the job description (including "nice to have" / "ways to stand out" sections).

2. For each keyword, look for a home in my existing bullet points:
   - Only integrate a keyword into a bullet if the work described in that bullet is plausibly related to it — do not fabricate experience.
   - If a keyword fits: REWRITE the bullet to incorporate it by replacing wordy or filler language with the keyword — do not extend the sentence. The rewritten bullet must be the same length or shorter than the original.
   - A single bullet can absorb multiple related keywords at once, as long as the bullet stays the same length or shorter.
   - PRIORITIZE putting keywords into bullets over Technical Skills. That is where ATS weight matters most.

3. After integrating into bullets, add every remaining keyword that did not find a bullet home to Technical Skills under the most appropriate existing category. There is no plausibility restriction here — add every keyword from the job description that is not already listed, regardless of whether you have direct experience with it.

4. Do not duplicate — if a keyword is already present somewhere in the resume, skip re-adding it.

5. You may shorten and rephrase bullet text to accommodate keywords, but never delete entire bullets or drop items from Technical Skills. Every bullet point and every Technical Skills entry must still be present in the output.

6. Preserve all formatting, layout, and one-page constraint.`;
}

export function buildCoverLetterPrompt(jobDescription: string): string {
  return `Write me a tailored cover letter for this role. Here's the job description:

${jobDescription}`;
}
